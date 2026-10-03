import { API_BASE_URL, PHOTOS_BASE_URL } from '../photos.js'
import { setMenuPublic } from '../admin-access.js'

// Admin panel for the wedding photos, served from github.io but talking to
// the Cloudflare Worker in cloudflare/ (see cloudflare/README.md) —
// previously an Infomaniak-hosted PHP API. Auth is a bearer token in
// localStorage rather than a cookie, same reasoning as before this
// migration: cross-site cookies get silently blocked by some browsers'
// privacy modes.
const API = API_BASE_URL + 'admin/'
const TOKEN_KEY = 'lm_admin_token'
const IMG_BASE = PHOTOS_BASE_URL

function encodeRelPath (relative) {
  if (!relative) return ''
  return relative.split('/').map(encodeURIComponent).join('/')
}

function getToken () { return localStorage.getItem(TOKEN_KEY) || '' }
// html.is-admin reveals the Galerie/Photos menu entries (see src/admin-access.js).
function setToken (token) {
  localStorage.setItem(TOKEN_KEY, token)
  document.documentElement.classList.add('is-admin')
}
function clearToken () {
  localStorage.removeItem(TOKEN_KEY)
  document.documentElement.classList.remove('is-admin')
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

// ── Toasts ──────────────────────────────────────────────────────
function toast (message, ok) {
  if (!message) return
  const host = document.getElementById('toast-host')
  const el = document.createElement('div')
  el.className = 'toast' + (ok ? ' toast-ok' : '')
  el.textContent = message
  host.appendChild(el)
  setTimeout(() => {
    el.classList.add('toast-hide')
    setTimeout(() => el.remove(), 400)
  }, 4000)
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
  // Swallowed here specifically: an expired/invalid token 401s, and
  // apiFetch already reacts to that by calling showLogin() itself — this
  // just stops that rejection from surfacing as an unhandled promise
  // rejection on top of it.
  loadState('').catch(() => {})
  loadSettings()
}

// ── Site settings ───────────────────────────────────────────────
// Read from the public /settings endpoint, written through the admin one.
const menuPublicToggle = document.getElementById('menu-public-toggle')

async function loadSettings () {
  try {
    const res = await fetch(API_BASE_URL + 'settings', { cache: 'no-store' })
    const settings = await res.json()
    menuPublicToggle.checked = Boolean(settings.menuPublic)
    setMenuPublic(menuPublicToggle.checked)
  } catch {}
}

menuPublicToggle.addEventListener('change', async () => {
  const wanted = menuPublicToggle.checked
  menuPublicToggle.disabled = true
  try {
    const settings = await apiFetch('settings', { method: 'POST', json: { menuPublic: wanted } })
    menuPublicToggle.checked = Boolean(settings.menuPublic)
    setMenuPublic(menuPublicToggle.checked)
    toast(settings.menuPublic
      ? 'Galerie et Photos sont maintenant visibles pour tous.'
      : 'Galerie et Photos sont maintenant masquées pour les visiteurs.', true)
  } catch (err) {
    menuPublicToggle.checked = !wanted
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
    // Land on the gallery; the dashboard is one click away via the Admin menu.
    location.assign('../#galerie')
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
  renderBreadcrumb(data.breadcrumb)
  renderUploadDest(data.allFolders, data.path)
  renderFolders(data.folders, data.path)
  renderTags(data.registry)
  renderMoveDest(data.allFolders)
  renderPhotos(data.photos, data.registry)
  document.getElementById('select-all').checked = false
}

function renderStorage (storage) {
  document.getElementById('storage-bar-fill').style.width = storage.usedPercent.toFixed(2) + '%'
  document.getElementById('storage-label').textContent = `${storage.usedLabel} / ${storage.maxLabel} utilisés`
}

function renderBreadcrumb (crumbs) {
  const nav = document.getElementById('breadcrumb')
  nav.innerHTML = ''
  const root = document.createElement('a')
  root.href = '#'
  root.textContent = 'img'
  root.addEventListener('click', (e) => { e.preventDefault(); loadState('') })
  nav.appendChild(root)

  const acc = []
  crumbs.forEach((crumb) => {
    acc.push(crumb)
    const sep = document.createElement('span')
    sep.textContent = '/'
    nav.appendChild(sep)
    const link = document.createElement('a')
    const path = acc.join('/')
    link.href = '#'
    link.textContent = crumb
    link.addEventListener('click', (e) => { e.preventDefault(); loadState(path) })
    nav.appendChild(link)
  })
}

function renderUploadDest (allFolders, currentRelPath) {
  const select = document.getElementById('upload-dest')
  select.innerHTML = ''
  const rootOpt = document.createElement('option')
  rootOpt.value = '.'
  rootOpt.textContent = 'img/ (racine)'
  if (currentRelPath === '') rootOpt.selected = true
  select.appendChild(rootOpt)
  allFolders.forEach((folder) => {
    const opt = document.createElement('option')
    opt.value = folder
    opt.textContent = folder
    if (folder === currentRelPath) opt.selected = true
    select.appendChild(opt)
  })
}

function renderFolders (folders, relPath) {
  const grid = document.getElementById('folders-grid')
  grid.innerHTML = ''
  document.getElementById('folder-bulk-bar').hidden = folders.length === 0

  folders.forEach((folder) => {
    const folderRel = relPath === '' ? folder : relPath + '/' + folder

    const wrap = document.createElement('div')
    wrap.className = 'folder-select'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'select-folder'
    checkbox.value = folderRel
    wrap.appendChild(checkbox)

    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'folder-tile'
    tile.innerHTML = '<span class="folder-icon">📁</span><span class="folder-name"></span>'
    tile.querySelector('.folder-name').textContent = folder
    tile.addEventListener('click', () => loadState(folderRel))
    wrap.appendChild(tile)

    grid.appendChild(wrap)
  })
}

function renderTags (registry) {
  const list = document.getElementById('tags-list')
  list.innerHTML = ''
  document.getElementById('tags-empty').hidden = registry.length > 0

  registry.forEach((tag) => {
    const li = document.createElement('li')
    const span = document.createElement('span')
    span.textContent = tag
    li.appendChild(span)

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
  const controls = document.getElementById('move-controls')
  const select = document.getElementById('move-dest')
  controls.hidden = allFolders.length === 0
  select.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = '.'
  placeholder.textContent = 'Déplacer'
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
  document.getElementById('photos-empty').hidden = photos.length > 0
  lightboxPaths = photos.map((p) => p.path)

  photos.forEach((photo, i) => {
    const figure = document.createElement('figure')
    figure.dataset.path = photo.path

    const selectWrap = document.createElement('div')
    selectWrap.className = 'photo-select'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'select-file'
    checkbox.value = photo.path
    selectWrap.appendChild(checkbox)

    const src = IMG_BASE + encodeRelPath(photo.path)
    const img = document.createElement('img')
    img.src = src
    img.alt = ''
    img.loading = 'lazy'
    img.addEventListener('click', () => openLightbox(i))
    selectWrap.appendChild(img)
    figure.appendChild(selectWrap)

    const caption = document.createElement('figcaption')
    caption.textContent = photo.filename
    figure.appendChild(caption)

    if (registry.length) {
      const tagChecks = document.createElement('div')
      tagChecks.className = 'tag-checks'
      registry.forEach((tag) => {
        const label = document.createElement('label')
        label.className = 'tag-check'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.value = tag
        cb.checked = photo.tags.includes(tag)
        label.appendChild(cb)
        label.appendChild(document.createTextNode(tag))
        tagChecks.appendChild(label)
      })
      figure.appendChild(tagChecks)
    } else {
      const p = document.createElement('p')
      p.className = 'tag-check-empty'
      p.textContent = 'Aucun tag défini'
      figure.appendChild(p)
    }

    const folderLabel = document.createElement('p')
    folderLabel.className = 'photo-folder'
    folderLabel.textContent = photo.folder === '' ? '📁 img/ (racine)' : '📁 ' + photo.folder
    figure.appendChild(folderLabel)

    grid.appendChild(figure)
  })
}

function selectedPhotoPaths () {
  return Array.from(document.querySelectorAll('.select-file:checked')).map((cb) => cb.value)
}

// ── Upload ────────────────────────────────────────────────────
document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const formData = new FormData(form)
  try {
    const data = await apiFetch('upload', { method: 'POST', formData })
    const parts = []
    if (data.uploaded > 0) parts.push(`${data.uploaded} photo(s) ajoutée(s).`)
    if (data.errors.length) parts.push('Erreurs : ' + data.errors.join(' '))
    toast(parts.join(' '), data.errors.length === 0)
    form.reset()
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

// ── Folder create / bulk delete ──────────────────────────────────
document.getElementById('create-folder-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('foldername')
  try {
    await apiFetch('create-folder', { method: 'POST', json: { path: currentPath, name: input.value } })
    toast('Dossier créé.', true)
    input.value = ''
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

function selectedFolders () {
  return Array.from(document.querySelectorAll('.select-folder:checked')).map((cb) => cb.value)
}

async function deleteFolders (mode) {
  const folders = selectedFolders()
  if (!folders.length) {
    alert('Sélectionnez au moins un dossier.')
    return
  }
  const message = mode === 'purge'
    ? 'Supprimer ces dossiers ET toutes les photos qu\'ils contiennent ? Action irréversible.'
    : 'Supprimer ces dossiers ? Les photos qu\'ils contiennent seront déplacées dans le dossier parent.'
  if (!confirm(message)) return
  try {
    const data = await apiFetch('delete-folder', { method: 'POST', json: { folders, mode } })
    toast(data.deleted > 0 ? `${data.deleted} dossier(s) supprimé(s).` : 'Aucun dossier supprimé.', data.deleted > 0 && data.skipped === 0)
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
}

document.getElementById('delete-folders-keep').addEventListener('click', () => deleteFolders('keep_photos'))
document.getElementById('delete-folders-purge').addEventListener('click', () => deleteFolders('purge'))

// ── Tags registry ──────────────────────────────────────────────
document.getElementById('add-tag-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('tagname')
  try {
    await apiFetch('add-tag', { method: 'POST', json: { name: input.value } })
    toast('Tag ajouté.', true)
    input.value = ''
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

// ── Photos: select all, delete, move, save tags ──────────────────
document.getElementById('select-all').addEventListener('change', (e) => {
  document.querySelectorAll('.select-file').forEach((cb) => { cb.checked = e.target.checked })
})

document.getElementById('delete-photos-btn').addEventListener('click', async () => {
  const files = selectedPhotoPaths()
  if (!files.length) {
    alert('Sélectionnez au moins une photo.')
    return
  }
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
  if (!files.length) {
    alert('Sélectionnez au moins une photo.')
    return
  }
  const dest = document.getElementById('move-dest').value
  try {
    const data = await apiFetch('move', { method: 'POST', json: { files, dest } })
    toast(data.moved > 0 ? `${data.moved} photo(s) déplacée(s).` : 'Aucune photo déplacée.', data.moved > 0 && data.skipped === 0)
    await loadState(currentPath)
  } catch (err) {
    toast(err.message, false)
  }
})

document.getElementById('save-tags-btn').addEventListener('click', async () => {
  const updates = Array.from(document.querySelectorAll('#photos-grid figure')).map((figure) => ({
    path: figure.dataset.path,
    tags: Array.from(figure.querySelectorAll('.tag-check input:checked')).map((cb) => cb.value),
  }))
  try {
    const data = await apiFetch('tag', { method: 'POST', json: { updates } })
    toast(data.updated > 0 ? `${data.updated} photo(s) mise(s) à jour.` : 'Aucune photo mise à jour.', data.updated > 0)
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
  lightboxImg.src = IMG_BASE + encodeRelPath(lightboxPaths[lbIndex])
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

// ── Init ────────────────────────────────────────────────────────
if (getToken()) {
  showDashboard()
} else {
  showLogin()
}
