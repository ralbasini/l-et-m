import { REMOTE_GALLERY_URL } from '../photos.js'

// Guest photo upload, served from github.io but talking to the
// Infomaniak-hosted PHP API. A guest's identity is a bearer token in
// localStorage (name + HMAC signature, verified server-side) instead of the
// signed cookie this used to be — see infomaniak/guest/auth.php for why
// (cross-site cookies get silently blocked by some browsers' privacy
// modes). Per-browser identity, same as the cookie was: switching devices
// still goes through the "Oui, c'est moi" collision flow.
const API = REMOTE_GALLERY_URL + 'guest/'
const TOKEN_KEY = 'lm_guest_token'
const IMG_BASE = REMOTE_GALLERY_URL + 'img/Invités/'

function getToken () { return localStorage.getItem(TOKEN_KEY) || '' }
function setToken (token) { localStorage.setItem(TOKEN_KEY, token) }
function clearToken () { localStorage.removeItem(TOKEN_KEY) }

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

  let data = null
  try { data = await res.json() } catch {}

  if (res.status === 401) {
    clearToken()
    showNameStep()
    throw new Error('Session expirée, merci de recommencer.')
  }
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

// ── Steps ─────────────────────────────────────────────────────
const nameStep = document.getElementById('name-step')
const collisionStep = document.getElementById('collision-step')
const uploadStep = document.getElementById('upload-step')
const myPhotosCard = document.getElementById('my-photos')

function showNameStep () {
  nameStep.hidden = false
  collisionStep.hidden = true
  uploadStep.hidden = true
  myPhotosCard.hidden = true
}

function showCollisionStep (pendingName) {
  document.getElementById('collision-name').textContent = pendingName
  nameStep.hidden = true
  collisionStep.hidden = false
  uploadStep.hidden = true
  myPhotosCard.hidden = true
}

function showUploadStep (guestName) {
  document.getElementById('guest-name-label').textContent = guestName
  nameStep.hidden = true
  collisionStep.hidden = true
  uploadStep.hidden = false
  myPhotosCard.hidden = false
}

// ── Name step ─────────────────────────────────────────────────
const nameForm = document.getElementById('name-form')
const nameError = document.getElementById('name-error')

nameForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  nameError.hidden = true
  const name = document.getElementById('name').value
  try {
    const data = await apiFetch('identify.php', { method: 'POST', json: { name } })
    if (data.status === 'collision') {
      showCollisionStep(data.pendingName)
    } else {
      setToken(data.token)
      await enterUploadStep(data.name)
    }
  } catch (err) {
    nameError.textContent = err.message
    nameError.hidden = false
  }
})

document.getElementById('collision-yes').addEventListener('click', async () => {
  const pendingName = document.getElementById('collision-name').textContent
  try {
    const data = await apiFetch('identify.php', { method: 'POST', json: { confirm_name: pendingName } })
    setToken(data.token)
    await enterUploadStep(data.name)
  } catch (err) {
    toast(err.message, false)
    showNameStep()
  }
})

document.getElementById('collision-no').addEventListener('click', () => {
  nameForm.reset()
  showNameStep()
})

document.getElementById('not-me-btn').addEventListener('click', () => {
  clearToken()
  nameForm.reset()
  showNameStep()
})

// ── Upload step ───────────────────────────────────────────────
async function enterUploadStep (guestName) {
  showUploadStep(guestName)
  await refreshMyPhotos()
}

function renderQuota (remaining, maxPerPerson) {
  currentRemaining = remaining
  const form = document.getElementById('upload-form')
  const label = document.getElementById('photos-label')
  const full = document.getElementById('quota-full')
  if (remaining <= 0) {
    form.hidden = true
    full.hidden = false
    full.textContent = `Vous avez envoyé vos ${maxPerPerson} photos, merci beaucoup !`
  } else {
    form.hidden = false
    full.hidden = true
    label.textContent = `Choisir des photos (${remaining} restante${remaining > 1 ? 's' : ''} sur ${maxPerPerson})`
  }
}

function renderPhotos (photos) {
  const grid = document.getElementById('photos-grid')
  grid.innerHTML = ''
  myPhotosCard.hidden = photos.length === 0
  lightboxFiles = photos

  photos.forEach((file, i) => {
    const figure = document.createElement('figure')

    const img = document.createElement('img')
    img.src = guestImgBase() + encodeURIComponent(file)
    img.alt = ''
    img.loading = 'lazy'
    img.addEventListener('click', () => openLightbox(i))
    figure.appendChild(img)

    const delBtn = document.createElement('button')
    delBtn.type = 'button'
    delBtn.className = 'delete-btn'
    delBtn.setAttribute('aria-label', 'Supprimer')
    delBtn.textContent = '×'
    delBtn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette photo ?')) return
      try {
        const data = await apiFetch('delete.php', { method: 'POST', json: { file } })
        toast('Photo supprimée.', true)
        renderPhotos(data.photos)
        renderQuota(data.remaining, currentMaxPerPerson)
      } catch (err) {
        toast(err.message, false)
      }
    })
    figure.appendChild(delBtn)

    grid.appendChild(figure)
  })
}

let currentGuestName = ''
let currentMaxPerPerson = 15
function guestImgBase () { return IMG_BASE + encodeURIComponent(currentGuestName) + '/' }

async function refreshMyPhotos () {
  const data = await apiFetch('me.php')
  currentGuestName = data.name
  currentMaxPerPerson = data.maxPerPerson
  renderQuota(data.remaining, data.maxPerPerson)
  renderPhotos(data.photos)
}

// ── Upload preview ────────────────────────────────────────────
// The bare <input type="file"> gives no feedback about what's about to be
// sent, and on a phone camera roll it's easy to fat-finger the wrong photo.
// This keeps our own File[] (selectedFiles) in sync with the input's real
// FileList via a DataTransfer, so thumbnails can be shown and individual
// photos removed before sending — the input alone can't do either.
const dropzoneText = document.getElementById('dropzone-text')
const photosInput = document.getElementById('photos')
const previewGrid = document.getElementById('preview-grid')
const previewWarning = document.getElementById('preview-warning')
const uploadSubmitBtn = document.getElementById('upload-submit')

let selectedFiles = []
let previewUrls = []
let currentRemaining = 15

function fileKey (file) {
  return [file.name, file.size, file.lastModified].join('|')
}

function syncInputFiles () {
  const dt = new DataTransfer()
  selectedFiles.forEach((file) => dt.items.add(file))
  photosInput.files = dt.files
}

function clearPreviewUrls () {
  previewUrls.forEach((url) => URL.revokeObjectURL(url))
  previewUrls = []
}

function renderPreview () {
  clearPreviewUrls()
  previewGrid.innerHTML = ''

  const count = selectedFiles.length
  previewGrid.hidden = count === 0
  uploadSubmitBtn.disabled = count === 0
  dropzoneText.textContent = count === 0
    ? 'Touchez pour choisir des photos'
    : `${count} photo${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''} — touchez pour en ajouter`

  if (count > currentRemaining) {
    previewWarning.hidden = false
    previewWarning.textContent = `Seules les ${currentRemaining} première${currentRemaining > 1 ? 's' : ''} seront envoyées (il n'en reste que ${currentRemaining}).`
  } else {
    previewWarning.hidden = true
  }

  selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file)
    previewUrls.push(url)

    const figure = document.createElement('figure')
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    figure.appendChild(img)

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'delete-btn'
    removeBtn.setAttribute('aria-label', 'Retirer cette photo de l’envoi')
    removeBtn.textContent = '×'
    removeBtn.addEventListener('click', () => {
      selectedFiles.splice(i, 1)
      syncInputFiles()
      renderPreview()
    })
    figure.appendChild(removeBtn)

    previewGrid.appendChild(figure)
  })
}

function resetPreview () {
  selectedFiles = []
  syncInputFiles()
  renderPreview()
}

// Each tap on the dropzone opens a fresh native picker that replaces
// FileList entirely (especially on iOS) — merge instead of replacing, so
// reopening it to add one more photo doesn't silently drop what was
// already chosen.
photosInput.addEventListener('change', () => {
  const existingKeys = new Set(selectedFiles.map(fileKey))
  Array.from(photosInput.files).forEach((file) => {
    const key = fileKey(file)
    if (!existingKeys.has(key)) {
      selectedFiles.push(file)
      existingKeys.add(key)
    }
  })
  syncInputFiles()
  renderPreview()
})

renderPreview()

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const formData = new FormData(form)
  try {
    const data = await apiFetch('upload.php', { method: 'POST', formData })
    const parts = []
    if (data.uploaded > 0) parts.push(`${data.uploaded} photo(s) envoyée(s), merci !`)
    if (data.errors.length) parts.push(data.errors.join(' '))
    toast(parts.join(' '), data.uploaded > 0 && data.errors.length === 0)
    form.reset()
    resetPreview()
    renderPhotos(data.photos)
    renderQuota(data.remaining, currentMaxPerPerson)
  } catch (err) {
    toast(err.message, false)
  }
})

// ── Lightbox ────────────────────────────────────────────────────
let lightboxFiles = []
const lightbox = document.getElementById('lightbox')
const lightboxImg = document.getElementById('lightbox-img')
const lightboxCount = document.getElementById('lightbox-count')
let lbIndex = 0

function lbShow (i) {
  lbIndex = (i + lightboxFiles.length) % lightboxFiles.length
  lightboxImg.src = guestImgBase() + encodeURIComponent(lightboxFiles[lbIndex])
  lightboxCount.textContent = `${lbIndex + 1} / ${lightboxFiles.length}`
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
async function init () {
  const token = getToken()
  if (!token) {
    showNameStep()
    return
  }
  try {
    const data = await apiFetch('me.php')
    currentGuestName = data.name
    currentMaxPerPerson = data.maxPerPerson
    showUploadStep(data.name)
    renderQuota(data.remaining, data.maxPerPerson)
    renderPhotos(data.photos)
  } catch {
    showNameStep()
  }
}

init()
