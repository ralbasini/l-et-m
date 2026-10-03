import { API_BASE_URL, photoUrl } from '../photos.js'
import { makeThumbnail } from '../thumbnail.js'
import { setMenuPublic, ADMIN_TOKEN_KEY as TOKEN_KEY } from '../admin-access.js'
import { toast } from '../toast.js'
import '../site-swipe-nav.js'

// Admin panel for the wedding photos, served from github.io but talking to
// the Cloudflare Worker in cloudflare/ (see cloudflare/README.md). Auth is a
// bearer token in localStorage rather than a cookie: cross-site cookies get
// silently blocked by some browsers' privacy modes.
const API = API_BASE_URL + 'admin/'

function getToken () { return localStorage.getItem(TOKEN_KEY) || '' }
// html.is-admin reveals the Galerie/Photos menu entries (see src/admin-access.js).
// The home page (the top window) holds the menu, so it gets the class too.
function setAdminClass (on) {
  for (const win of new Set([window, window.top])) {
    try { win.document.documentElement.classList.toggle('is-admin', on) } catch {}
  }
}
function setToken (token) {
  localStorage.setItem(TOKEN_KEY, token)
  setAdminClass(true)
}
function clearToken () {
  localStorage.removeItem(TOKEN_KEY)
  setAdminClass(false)
}

// Every call attaches the bearer token (if any); a 401 always means the
// token is missing/expired, so it uniformly bounces back to the login
// screen rather than every caller having to handle that case itself.
async function apiFetch (path, { method = 'GET', json, formData } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = 'Bearer ' + token

  let body
  if (formData) {
    body = formData
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }

  const res = await fetch(API + path, { method, headers, body })

  // A 401 from login itself is just a wrong password — let its own message
  // through below instead of treating it as an expired session.
  if (res.status === 401 && path !== 'login') {
    clearToken()
    showLogin()
    throw new Error('Session expirée, merci de vous reconnecter.')
  }

  let data = null
  try { data = await res.json() } catch {}

  if (!res.ok) {
    throw new Error((data && data.error) || 'Une erreur est survenue.')
  }
  return data
}

// ── View switching ────────────────────────────────────────────
const loginView = document.getElementById('login-view')
const dashboardView = document.getElementById('dashboard-view')

function showLogin () {
  loginView.hidden = false
  dashboardView.hidden = true
}

function showDashboard () {
  loginView.hidden = true
  dashboardView.hidden = false
  document.getElementById('photos-grid').innerHTML = '<p class="grid-loading">Chargement…</p>'
  // Swallowed here specifically: an expired/invalid token 401s, and
  // apiFetch already reacts to that by calling showLogin() itself — this
  // just stops that rejection from surfacing as an unhandled promise
  // rejection on top of it.
  loadState('').catch(() => {})
  loadSettings()
}

// ── Missing thumbnails ──────────────────────────────────────────
// A photo with no stored thumbnail would load at full size in the grid. Show
// the original once, and meanwhile make the thumbnail here and send it to the
// Worker (one at a time) so the next load is light.
const thumbQueue = []
let thumbWorking = false

function loadAdminThumb (img, path) {
  img.src = photoUrl('_thumbs/' + path)
  img.addEventListener('error', () => {
    img.src = photoUrl(path)
    thumbQueue.push(path)
    if (!thumbWorking) backfillThumbs()
  }, { once: true })
}

async function backfillThumbs () {
  thumbWorking = true
  while (thumbQueue.length) {
    const path = thumbQueue.shift()
    try {
      const res = await fetch(photoUrl(path))
      const thumb = res.ok ? await makeThumbnail(await res.blob()) : null
      if (!thumb) continue
      const formData = new FormData()
      formData.append('path', path)
      formData.append('thumb', thumb, 'thumb.jpg')
      await apiFetch('thumb', { method: 'POST', formData })
    } catch {}
  }
  thumbWorking = false
}

// ── Site settings ───────────────────────────────────────────────
// Read from the public /settings endpoint, written through the admin one.
const menuPublicToggle = document.getElementById('menu-public-toggle')
const visibilityBadge = document.getElementById('visibility-badge')

// "Privée" / "Publique" next to the card title, from the switch.
function renderVisibility () {
  const isPublic = menuPublicToggle.checked
  visibilityBadge.textContent = isPublic ? 'Publique' : 'Privée'
  visibilityBadge.classList.toggle('is-public', isPublic)
}

async function loadSettings () {
  try {
    const res = await fetch(API_BASE_URL + 'settings', { cache: 'no-store' })
    const settings = await res.json()
    menuPublicToggle.checked = Boolean(settings.menuPublic)
    setMenuPublic(menuPublicToggle.checked)
    renderVisibility()
  } catch {}
}

menuPublicToggle.addEventListener('change', async () => {
  const wanted = menuPublicToggle.checked
  renderVisibility()
  menuPublicToggle.disabled = true
  try {
    const settings = await apiFetch('settings', { method: 'POST', json: { menuPublic: wanted } })
    menuPublicToggle.checked = Boolean(settings.menuPublic)
    setMenuPublic(menuPublicToggle.checked)
    renderVisibility()
    toast(settings.menuPublic
      ? 'Galerie et Photos sont maintenant visibles pour tous.'
      : 'Galerie et Photos sont maintenant masquées pour les visiteurs.', true)
  } catch (err) {
    menuPublicToggle.checked = !wanted
    renderVisibility()
    toast(err.message)
  } finally {
    menuPublicToggle.disabled = false
  }
})

// ── Login ───────────────────────────────────────────────────────
const loginForm = document.getElementById('login-form')
const loginError = document.getElementById('login-error')

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  loginError.hidden = true
  const password = document.getElementById('password').value
  try {
    const data = await apiFetch('login', { method: 'POST', json: { password } })
    setToken(data.token)
    // Land on the gallery (reloading the whole site so the menu updates); the
    // dashboard is one click away via the Admin menu.
    window.top.location.hash = 'galerie'
    window.top.location.reload()
  } catch (err) {
    loginError.textContent = err.message
    loginError.hidden = false
  }
})

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await apiFetch('logout', { method: 'POST' }) } catch {}
  clearToken()
  showLogin()
})

// ── Dashboard state ───────────────────────────────────────────────
let currentPath = ''
let lightboxPaths = []

async function loadState (path) {
  const data = await apiFetch('state?path=' + encodeURIComponent(path ?? currentPath))
  currentPath = data.path
  render(data)
}

function render (data) {
  renderStorage(data.storage)
  renderUploadDest(data.allFolders, data.path)
  renderFolderSelect(data.allFolders, data.path)
  renderTags(data.registry)
  renderMoveDest(data.allFolders)
  renderPhotos(data.photos, data.registry)
  document.getElementById('select-all').checked = false
}

function renderStorage (storage) {
  document.getElementById('storage-bar-fill').style.width = storage.usedPercent.toFixed(2) + '%'
  document.getElementById('storage-label').textContent = `${storage.usedLabel} / ${storage.maxLabel} utilisés`
}

function renderUploadDest (allFolders, currentRelPath) {
  // No top-level (img/ racine) option: uploads always go into a folder (the
  // Worker refuses the top level too). The empty placeholder makes the
  // required <select> force a choice. Keeps the folder already picked
  // across re-renders (e.g. after an upload), else the open folder.
  const select = document.getElementById('upload-dest')
  const wanted = allFolders.includes(select.value) ? select.value : currentRelPath
  select.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.disabled = true
  placeholder.textContent = allFolders.length ? 'Choisissez un dossier…' : 'Créez d’abord un dossier (section Photos)'
  select.appendChild(placeholder)
  allFolders.forEach((folder) => {
    const opt = document.createElement('option')
    opt.value = folder
    opt.textContent = folder
    select.appendChild(opt)
  })
  select.value = allFolders.includes(wanted) ? wanted : ''
}

// The whole folder tree in one selector: "Toutes les photos" (every photo,
// from all folders), then each folder indented under its parent —
// allFolders comes sorted by path, so children follow their parent.
// Picking one shows its photos; the folder actions below apply to it.
const folderSelect = document.getElementById('folder-select')

function renderFolderSelect (allFolders, currentRelPath) {
  folderSelect.innerHTML = ''
  const all = document.createElement('option')
  all.value = ''
  all.textContent = 'Toutes les photos'
  folderSelect.appendChild(all)
  allFolders.forEach((folder) => {
    const segments = folder.split('/')
    const depth = segments.length - 1
    const opt = document.createElement('option')
    opt.value = folder
    opt.textContent = '   '.repeat(depth) + (depth ? '└ ' : '') + segments[depth]
    folderSelect.appendChild(opt)
  })
  folderSelect.value = currentRelPath

  const name = currentRelPath.split('/').pop()
  document.getElementById('folder-actions').hidden = currentRelPath === ''
  // "Keep the photos" moves them up to the parent folder — not offered for
  // a top-level folder, whose parent is the top level, where photos may
  // not go (same rule as uploads).
  document.getElementById('delete-folders-keep').hidden = !currentRelPath.includes('/')
  document.getElementById('foldername-label').textContent = currentRelPath
    ? `Nouveau dossier dans « ${name} »`
    : 'Nouveau dossier'
}

folderSelect.addEventListener('change', () => {
  loadState(folderSelect.value).catch((err) => toast(err.message, false))
})

function renderTags (registry) {
  const list = document.getElementById('tags-list')
  list.innerHTML = ''
  document.getElementById('tags-empty').hidden = registry.length > 0

  // Forget filters on tags that no longer exist.
  activeTagFilters.forEach((tag) => { if (!registry.includes(tag)) activeTagFilters.delete(tag) })

  registry.forEach((tag) => {
    const li = document.createElement('li')
    li.classList.toggle('is-active', activeTagFilters.has(tag))
    setTagColor(li, tag)

    // The tag's name filters the photos shown (see applyTagFilter()).
    const filterBtn = document.createElement('button')
    filterBtn.type = 'button'
    filterBtn.className = 'tag-filter'
    filterBtn.textContent = tag
    filterBtn.title = `N’afficher que les photos « ${tag} »`
    filterBtn.setAttribute('aria-pressed', String(activeTagFilters.has(tag)))
    filterBtn.addEventListener('click', () => {
      if (activeTagFilters.has(tag)) activeTagFilters.delete(tag)
      else activeTagFilters.add(tag)
      const on = activeTagFilters.has(tag)
      li.classList.toggle('is-active', on)
      filterBtn.setAttribute('aria-pressed', String(on))
      applyTagFilter()
    })
    li.appendChild(filterBtn)

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'tag-remove'
    removeBtn.setAttribute('aria-label', 'Supprimer le tag ' + tag)
    removeBtn.textContent = '×'
    removeBtn.addEventListener('click', async () => {
      if (!confirm('Supprimer ce tag ? Il sera retiré de toutes les photos qui l\'ont.')) return
      try {
        await apiFetch('delete-tag', { method: 'POST', json: { name: tag } })
        toast('Tag supprimé.', true)
        await loadState(currentPath)
      } catch (err) {
        toast(err.message, false)
      }
    })
    li.appendChild(removeBtn)
    list.appendChild(li)
  })
}

function renderMoveDest (allFolders) {
  // Shown by renderSelectionTags() only while photos are selected.
  hasFolders = allFolders.length > 0
  const select = document.getElementById('move-dest')
  select.innerHTML = ''
  // A placeholder, not a destination: photos never go to the top level
  // (same rule as uploads).
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Déplacer vers…'
  select.appendChild(placeholder)
  allFolders.forEach((folder) => {
    const opt = document.createElement('option')
    opt.value = folder
    opt.textContent = folder
    select.appendChild(opt)
  })
}

function renderPhotos (photos, registry) {
  const grid = document.getElementById('photos-grid')
  grid.innerHTML = ''
  lightboxPaths = photos.map((p) => p.path)

  photos.forEach((photo, i) => {
    const figure = document.createElement('figure')
    figure.className = 'photo-card'
    figure.dataset.path = photo.path

    const selectWrap = document.createElement('div')
    selectWrap.className = 'photo-select'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'select-file'
    // No visible checkbox: clicking the photo toggles it (below), and a
    // selected photo gets a teal outline + check badge. It just holds the state.
    checkbox.hidden = true
    checkbox.value = photo.path
    selectWrap.appendChild(checkbox)

    const img = document.createElement('img')
    loadAdminThumb(img, photo.path)
    img.alt = ''
    img.loading = 'lazy'
    // Clicking the photo selects/unselects it; full screen is the small
    // icon in its top-right corner.
    img.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked
      checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    })
    selectWrap.appendChild(img)

    const zoomBtn = document.createElement('button')
    zoomBtn.type = 'button'
    zoomBtn.className = 'photo-zoom'
    zoomBtn.setAttribute('aria-label', 'Afficher en plein écran')
    zoomBtn.title = 'Afficher en plein écran'
    zoomBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
    zoomBtn.addEventListener('click', () => openLightbox(i))
    selectWrap.appendChild(zoomBtn)

    figure.appendChild(selectWrap)

    const caption = document.createElement('figcaption')
    caption.textContent = photo.filename
    figure.appendChild(caption)

    // The photo's tags, as pills under its file name. Tagging itself is
    // done by selecting photos (see below).
    const tagPills = document.createElement('div')
    tagPills.className = 'photo-tags'
    figure.appendChild(tagPills)
    setFigureTags(figure, photo.tags)

    const folderLabel = document.createElement('p')
    folderLabel.className = 'photo-folder'
    folderLabel.textContent = photo.folder === '' ? '📁 img/ (racine)' : '📁 ' + photo.folder
    figure.appendChild(folderLabel)

    grid.appendChild(figure)
  })
  currentRegistry = registry
  applyTagFilter()
}

// ── Tag filter ───────────────────────────────────────────────────
// Clicking a tag in the Tags row shows only the displayed photos that have
// it; several active tags show photos with any of them (same as the
// gallery's filters). Kept across folder changes. Photos it hides are
// unselected, so actions never apply to photos out of sight. Re-run after
// tagging from the selection bar, once that selection has been cleared.
const activeTagFilters = new Set()

function applyTagFilter () {
  const figures = Array.from(photosGrid.querySelectorAll('figure.photo-card'))
  let shown = 0
  figures.forEach((figure) => {
    const visible = activeTagFilters.size === 0 ||
      figureTags(figure).some((tag) => activeTagFilters.has(tag))
    figure.hidden = !visible
    if (!visible) figure.querySelector('.select-file').checked = false
    if (visible) shown += 1
  })
  const empty = document.getElementById('photos-empty')
  empty.hidden = shown > 0
  empty.textContent = figures.length && activeTagFilters.size
    ? 'Aucune photo avec ce tag ici.'
    : 'Aucune photo pour l’instant.'
  renderSelectionTags()
}

// A photo card's tags live in data-tags (comma-separated) and are drawn as
// the pills on its thumbnail.
function figureTags (figure) {
  return figure.dataset.tags ? figure.dataset.tags.split(',') : []
}

function setFigureTags (figure, tags) {
  figure.dataset.tags = tags.join(',')
  const pills = figure.querySelector('.photo-tags')
  pills.innerHTML = ''
  tags.forEach((tag) => {
    const pill = document.createElement('span')
    pill.className = 'photo-tag'
    pill.textContent = tag
    setTagColor(pill, tag)
    pills.appendChild(pill)
  })
  // Untagged photos say so, which makes them easy to spot.
  if (!tags.length) {
    const none = document.createElement('span')
    none.className = 'photo-tag is-none'
    none.textContent = 'aucun tag'
    pills.appendChild(none)
  }
}

// Each tag gets its own color, picked from its name (so it stays the same
// when other tags are added or removed): a soft background + dark text, and
// a solid shade for the active filter. Used through --tag-* in style.css.
const TAG_PALETTE = [
  ['#d7e7e3', '#2a5951', '#356d65'], // teal
  ['#f3dde0', '#8a3846', '#a34858'], // rose
  ['#f5e6cc', '#7a5212', '#b07a1f'], // amber
  ['#e4def2', '#4e3f80', '#6a59a8'], // lavender
  ['#d8e8f3', '#2c5878', '#3c76a0'], // sky
  ['#e3ead2', '#4f5f22', '#6c8030'], // olive
  ['#f6e0d4', '#8a4425', '#b65a32'], // peach
  ['#e0e3e6', '#3e4852', '#5a6672'], // slate
]

function setTagColor (el, tag) {
  let hash = 5381
  for (const char of tag.normalize('NFC')) hash = ((hash * 33) ^ char.codePointAt(0)) >>> 0
  const [bg, fg, solid] = TAG_PALETTE[hash % TAG_PALETTE.length]
  el.style.setProperty('--tag-bg', bg)
  el.style.setProperty('--tag-fg', fg)
  el.style.setProperty('--tag-solid', solid)
}

function selectedPhotoPaths () {
  return Array.from(document.querySelectorAll('.select-file:checked')).map((cb) => cb.value)
}

// ── Tagging several photos at once ──────────────────────────────
// The only way to tag: select photos, then click a tag in the bar above the
// grid. That adds it to every selected photo — or, if they all have it
// already, removes it from all of them — saves right away, and updates the
// pills on their thumbnails.
let currentRegistry = []
let hasFolders = false
const photosGrid = document.getElementById('photos-grid')

function selectedFigures () {
  return Array.from(photosGrid.querySelectorAll('figure.photo-card'))
    .filter((figure) => figure.querySelector('.select-file').checked)
}

function renderSelectionTags () {
  const figures = selectedFigures()
  photosGrid.querySelectorAll('figure.photo-card').forEach((figure) => {
    figure.classList.toggle('is-selected', figures.includes(figure))
  })
  // The actions on the selection (move, delete) only show while there is one.
  document.getElementById('move-controls').hidden = figures.length === 0 || !hasFolders
  document.getElementById('delete-photos-btn').hidden = figures.length === 0

  const bar = document.getElementById('selection-tags')
  bar.hidden = figures.length === 0
  if (bar.hidden) return

  document.getElementById('selection-count').textContent =
    `${figures.length} photo${figures.length > 1 ? 's' : ''} sélectionnée${figures.length > 1 ? 's' : ''} :`
  const chips = document.getElementById('selection-tag-chips')
  chips.innerHTML = ''
  if (!currentRegistry.length) {
    const empty = document.createElement('span')
    empty.className = 'empty'
    empty.textContent = 'Aucun tag défini — ajoutez-en dans la section Tags.'
    chips.appendChild(empty)
    return
  }

  currentRegistry.forEach((tag) => {
    const withTag = figures.filter((figure) => figureTags(figure).includes(tag)).length
    const all = withTag === figures.length
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'tag-chip' + (all ? ' is-on' : withTag ? ' is-partial' : '')
    chip.setAttribute('aria-pressed', all ? 'true' : withTag ? 'mixed' : 'false')
    chip.title = all
      ? `Retirer « ${tag} » des photos sélectionnées`
      : `Ajouter « ${tag} » aux photos sélectionnées`
    chip.textContent = tag
    chip.addEventListener('click', () => applyTagToSelection(tag, !all))
    chips.appendChild(chip)
  })
}

async function applyTagToSelection (tag, add) {
  const figures = selectedFigures()
  if (!figures.length) return
  // Update the cards right away (kept in registry order); undo if the save fails.
  const previous = figures.map((figure) => [figure, figureTags(figure)])
  figures.forEach((figure) => {
    const tags = figureTags(figure).filter((t) => t !== tag)
    if (add) tags.push(tag)
    setFigureTags(figure, currentRegistry.filter((t) => tags.includes(t)))
  })
  renderSelectionTags()

  const updates = figures.map((figure) => ({ path: figure.dataset.path, tags: figureTags(figure) }))
  try {
    await apiFetch('tag', { method: 'POST', json: { updates } })
    // Done with this selection: clear it, and re-apply any tag filter now
    // that these photos' tags changed.
    photosGrid.querySelectorAll('.select-file').forEach((cb) => { cb.checked = false })
    document.getElementById('select-all').checked = false
    applyTagFilter()
    toast(`« ${tag} » ${add ? 'ajouté à' : 'retiré de'} ${figures.length} photo${figures.length > 1 ? 's' : ''}.`, true)
  } catch (err) {
    previous.forEach(([figure, tags]) => setFigureTags(figure, tags))
    renderSelectionTags()
    toast(err.message, false)
  }
}

// Selecting/unselecting a photo refreshes the tag bar.
photosGrid.addEventListener('change', (e) => {
  if (e.target.matches('.select-file')) renderSelectionTags()
})

// ── Upload ────────────────────────────────────────────────────
// Same flow as the guest page (src/photos/main.js): pick photos in the
// dropzone (each pick adds to the selection), review them as pending
// previews — removable one by one — then "Envoyer". Sent one per request
// so a big batch never hits the Worker's request-size limit; photos that
// fail stay selected for another try.
const photosInput = document.getElementById('photos')
const dropzoneText = document.getElementById('dropzone-text')
const previewGrid = document.getElementById('preview-grid')
const uploadSubmitBtn = document.getElementById('upload-submit')
let selectedFiles = []
let previewUrls = []

function fileKey (file) {
  return [file.name, file.size, file.lastModified].join('|')
}

function renderPreview () {
  previewUrls.forEach((url) => URL.revokeObjectURL(url))
  previewUrls = []
  previewGrid.innerHTML = ''

  const count = selectedFiles.length
  previewGrid.hidden = count === 0
  uploadSubmitBtn.disabled = count === 0
  // Only shown once there is something to send.
  uploadSubmitBtn.hidden = count === 0
  dropzoneText.textContent = count === 0
    ? 'Choisir des photos'
    : `${count} photo${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''} — en ajouter d’autres`

  selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file)
    previewUrls.push(url)

    // Dotted border + clock badge: selected, not sent yet (src/ui.css).
    const figure = document.createElement('figure')
    figure.className = 'is-pending'
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    figure.appendChild(img)

    const pendingBadge = document.createElement('span')
    pendingBadge.className = 'pending-badge'
    pendingBadge.title = 'En attente d’envoi'
    pendingBadge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
      '<span class="visually-hidden">En attente d’envoi</span>'
    figure.appendChild(pendingBadge)

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'delete-btn'
    removeBtn.setAttribute('aria-label', 'Retirer cette photo de l’envoi')
    removeBtn.textContent = '×'
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(i, 1)
      renderPreview()
    })
    figure.appendChild(removeBtn)

    previewGrid.appendChild(figure)
  })
}

// Each tap opens a fresh picker whose FileList replaces the last one, so
// merge into our own selection instead.
photosInput.addEventListener('change', () => {
  const existingKeys = new Set(selectedFiles.map(fileKey))
  let added = 0
  Array.from(photosInput.files).forEach((file) => {
    const key = fileKey(file)
    if (!existingKeys.has(key)) {
      selectedFiles.push(file)
      existingKeys.add(key)
      added += 1
    }
  })
  photosInput.value = ''
  renderPreview()
  // Bring "Envoyer" into view — centered, so the fixed menu can't cover it.
  if (added > 0) {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    uploadSubmitBtn.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
  }
})

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!selectedFiles.length) return
  const destSelect = document.getElementById('upload-dest')
  const dest = destSelect.value
  if (!dest) {
    toast('Choisissez un dossier de destination.', false)
    destSelect.focus()
    return
  }
  const files = selectedFiles.slice()
  const failed = []
  const errors = []
  let uploaded = 0

  uploadSubmitBtn.disabled = true
  uploadSubmitBtn.classList.add('is-uploading')
  try {
    for (const [i, file] of files.entries()) {
      uploadSubmitBtn.textContent = `Envoi ${i + 1} / ${files.length}…`
      const formData = new FormData()
      formData.append('path', dest)
      formData.append('photos[]', file)
      const thumb = await makeThumbnail(file)
      if (thumb) formData.append('thumb', thumb, 'thumb.jpg')
      try {
        const data = await apiFetch('upload', { method: 'POST', formData })
        uploaded += data.uploaded
        if (data.errors.length) errors.push(...data.errors)
        if (!data.uploaded) failed.push(file)
      } catch (err) {
        failed.push(file)
        errors.push(`${file.name} : ${err.message}`)
      }
    }
  } finally {
    uploadSubmitBtn.classList.remove('is-uploading')
    uploadSubmitBtn.textContent = 'Envoyer'
  }

  const parts = []
  if (uploaded > 0) parts.push(`${uploaded} photo(s) ajoutée(s).`)
  if (errors.length) parts.push('Erreurs : ' + errors.join(' '))
  toast(parts.join(' '), errors.length === 0)
  selectedFiles = failed
  renderPreview()
  await loadState(currentPath).catch(() => {})
})

renderPreview()

// ── Folder create / bulk delete ──────────────────────────────────
// The name field only shows after the + button (next to the folder
// selector); Annuler, Escape or a successful creation hide it again.
const createFolderForm = document.getElementById('create-folder-form')
const folderNameInput = document.getElementById('foldername')

function showCreateFolder (show) {
  createFolderForm.hidden = !show
  folderNameInput.value = ''
  if (show) folderNameInput.focus()
}

document.getElementById('new-folder-btn').addEventListener('click', () => showCreateFolder(createFolderForm.hidden))
document.getElementById('cancel-folder-btn').addEventListener('click', () => showCreateFolder(false))
folderNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') showCreateFolder(false)
})

createFolderForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await apiFetch('create-folder', { method: 'POST', json: { path: currentPath, name: folderNameInput.value } })
    toast('Dossier créé.', true)
    showCreateFolder(false)
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

// Deletes the folder shown in the selector, then shows its parent.
async function deleteFolders (mode) {
  if (!currentPath) return
  const name = currentPath.split('/').pop()
  const parent = currentPath.split('/').slice(0, -1).join('/')
  const message = mode === 'purge'
    ? `Supprimer le dossier « ${name} » ET toutes les photos qu'il contient (sous-dossiers compris) ? Action irréversible.`
    : `Supprimer le dossier « ${name} » ? Ses photos seront déplacées dans « ${parent.split('/').pop()} ».`
  if (!confirm(message)) return
  try {
    const data = await apiFetch('delete-folder', { method: 'POST', json: { folders: [currentPath], mode } })
    toast(data.deleted > 0 ? 'Dossier supprimé.' : 'Aucun dossier supprimé.', data.deleted > 0 && data.skipped === 0)
    await loadState(parent)
  } catch (err) {
    toast(err.message, false)
  }
}

document.getElementById('delete-folders-keep').addEventListener('click', () => deleteFolders('keep_photos'))
document.getElementById('delete-folders-purge').addEventListener('click', () => deleteFolders('purge'))

// ── Tags registry ──────────────────────────────────────────────
// Same pattern as folders: the name field only shows after the + button
// next to the tags; Annuler, Escape or a successful creation hide it again.
const addTagForm = document.getElementById('add-tag-form')
const tagNameInput = document.getElementById('tagname')

function showAddTag (show) {
  addTagForm.hidden = !show
  tagNameInput.value = ''
  if (show) tagNameInput.focus()
}

document.getElementById('new-tag-btn').addEventListener('click', () => showAddTag(addTagForm.hidden))
document.getElementById('cancel-tag-btn').addEventListener('click', () => showAddTag(false))
tagNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') showAddTag(false)
})

addTagForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await apiFetch('add-tag', { method: 'POST', json: { name: tagNameInput.value } })
    toast('Tag créé.', true)
    showAddTag(false)
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

// ── Photos: select all, delete, move, save tags ──────────────────
document.getElementById('select-all').addEventListener('change', (e) => {
  // Only the photos currently shown (the tag filter may hide some).
  photosGrid.querySelectorAll('figure.photo-card:not([hidden]) .select-file').forEach((cb) => { cb.checked = e.target.checked })
  renderSelectionTags()
})

document.getElementById('delete-photos-btn').addEventListener('click', async () => {
  const files = selectedPhotoPaths()
  if (!confirm('Supprimer les photos sélectionnées ?')) return
  try {
    const data = await apiFetch('delete', { method: 'POST', json: { files } })
    toast(data.deleted > 0 ? `${data.deleted} photo(s) supprimée(s).` : 'Aucune photo supprimée.', data.deleted > 0 && data.skipped === 0)
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

document.getElementById('move-btn').addEventListener('click', async () => {
  const files = selectedPhotoPaths()
  const dest = document.getElementById('move-dest').value
  if (!dest) {
    toast('Choisissez le dossier de destination.', false)
    return
  }
  try {
    const data = await apiFetch('move', { method: 'POST', json: { files, dest } })
    toast(data.moved > 0 ? `${data.moved} photo(s) déplacée(s).` : 'Aucune photo déplacée.', data.moved > 0 && data.skipped === 0)
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

// ── Lightbox ────────────────────────────────────────────────────
const lightbox = document.getElementById('lightbox')
const lightboxImg = document.getElementById('lightbox-img')
const lightboxCount = document.getElementById('lightbox-count')
let lbIndex = 0

function lbShow (i) {
  lbIndex = (i + lightboxPaths.length) % lightboxPaths.length
  lightboxImg.src = photoUrl(lightboxPaths[lbIndex])
  lightboxCount.textContent = `${lbIndex + 1} / ${lightboxPaths.length}`
}

function openLightbox (i) {
  lbShow(i)
  lightbox.hidden = false
  document.body.style.overflow = 'hidden'
}

function closeLightbox () {
  lightbox.hidden = true
  document.body.style.overflow = ''
}

document.getElementById('lightbox-close').addEventListener('click', closeLightbox)
document.getElementById('lightbox-overlay').addEventListener('click', closeLightbox)
document.getElementById('lightbox-prev').addEventListener('click', () => lbShow(lbIndex - 1))
document.getElementById('lightbox-next').addEventListener('click', () => lbShow(lbIndex + 1))

document.addEventListener('keydown', (e) => {
  if (lightbox.hidden) return
  if (e.key === 'Escape') closeLightbox()
  if (e.key === 'ArrowLeft') lbShow(lbIndex - 1)
  if (e.key === 'ArrowRight') lbShow(lbIndex + 1)
})

let touchStartX = 0
lightbox.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX }, { passive: true })
lightbox.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX
  if (Math.abs(dx) < 40) return
  lbShow(lbIndex + (dx < 0 ? 1 : -1))
}, { passive: true })

// ── Login: keep the button above the mobile keyboard ────────────
// When the keyboard opens (focus, then the visual viewport shrinks), scroll
// so "Se connecter" is visible, not hidden under it.
const loginPassword = document.getElementById('password')
const loginSubmit = document.querySelector('#login-form button[type="submit"]')
function revealLoginButton () {
  if (document.activeElement === loginPassword) loginSubmit.scrollIntoView({ block: 'end', behavior: 'smooth' })
}
loginPassword.addEventListener('focus', () => setTimeout(revealLoginButton, 300))
window.visualViewport?.addEventListener('resize', revealLoginButton)

// ── Init ────────────────────────────────────────────────────────
if (getToken()) {
  showDashboard()
} else {
  showLogin()
}
