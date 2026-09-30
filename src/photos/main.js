import { REMOTE_GALLERY_URL } from '../photos.js'
import '../site-swipe-nav.js'

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

// `retryable` marks failures worth trying again as-is: the connection
// dropped, or the server/proxy was overloaded (5xx, 408, 429). Note that a
// raw fetch() "Failed to fetch" TypeError also covers errors produced before
// PHP runs (proxy 413/502/504…) — those carry no CORS headers, so the
// browser hides them behind a generic network error.
class ApiError extends Error {
  constructor (message, { status = 0, retryable = false } = {}) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

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

  let res
  try {
    res = await fetch(API + path, { method, headers, body })
  } catch {
    throw new ApiError('Connexion au serveur impossible, vérifiez votre réseau.', { retryable: true })
  }

  let data = null
  try { data = await res.json() } catch {}

  if (res.status === 401) {
    clearToken()
    showNameStep()
    throw new ApiError('Session expirée, merci de recommencer.', { status: 401 })
  }
  if (!res.ok) {
    throw new ApiError((data && data.error) || 'Une erreur est survenue.', {
      status: res.status,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429
    })
  }
  return data
}

// ── Toasts ──────────────────────────────────────────────────────
function toast (message, ok, durationMs = 4000) {
  if (!message) return
  const host = document.getElementById('toast-host')
  const el = document.createElement('div')
  el.className = 'toast' + (ok ? ' toast-ok' : '')
  el.textContent = message
  host.appendChild(el)
  setTimeout(() => {
    el.classList.add('toast-hide')
    setTimeout(() => el.remove(), 400)
  }, durationMs)
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
  leftovers = null // bookkeeping for the previous identity's folder
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

// A file the browser can't decode (an old HEIC upload from before the fix
// above, or any other unsupported format) would otherwise show nothing at
// all — a blank tile reads as a loading delay, not a real problem, so swap
// in an explicit "can't preview this" placeholder instead.
function addImgFallback (img, figure) {
  img.addEventListener('error', () => {
    // Not the `hidden` attribute: `.grid figure img` sets `display: block`
    // at the same specificity the UA stylesheet's `[hidden]` rule uses, and
    // author styles win that tie — same reason .empty needs its own
    // `[hidden]` override elsewhere in this codebase. An inline style
    // always wins regardless.
    img.style.display = 'none'
    const fallback = document.createElement('div')
    fallback.className = 'img-fallback'
    fallback.textContent = 'Aperçu indisponible'
    figure.appendChild(fallback)
  }, { once: true })
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
    addImgFallback(img, figure)

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
const uploadProgress = document.getElementById('upload-progress')

let selectedFiles = []
let previewUrls = []
let currentRemaining = 15
let isUploading = false
// Photos from the last batch that still couldn't be sent after the
// automatic retries (they stay selected), plus the server filenames already
// accounted for at that point — so the next send can first check whether any
// of them actually arrived (see uploadBatch()). null when there are none.
let leftovers = null

function fileKey (file) {
  return [file.name, file.size, file.lastModified].join('|')
}

// iPhones save photos as HEIC/HEIF by default. No browser can render that
// format in an <img> (so the preview shows nothing), and it's a common
// reason uploads then get rejected server-side too — converting to a JPEG
// blob before it ever reaches the preview or upload.php fixes both. The
// decoder is ~1.3MB, so it's only fetched when a HEIC file is actually
// picked, not paid for by every guest.
function isHeicFile (file) {
  if (/^image\/heic$|^image\/heif$/i.test(file.type)) return true
  return !file.type && /\.hei[cf]$/i.test(file.name)
}

async function convertHeicToJpeg (file) {
  if (!isHeicFile(file)) return file
  try {
    const { default: heic2any } = await import('heic2any')
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    const blob = Array.isArray(result) ? result[0] : result
    const name = file.name.replace(/\.hei[cf]$/i, '.jpg')
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    // Couldn't decode it client-side either — hand back the original and
    // let the existing preview/upload error paths surface the failure.
    return file
  }
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
  const onlyLeftovers = leftovers && count > 0 && selectedFiles.every((f) => leftovers.files.has(f))
  uploadSubmitBtn.textContent = onlyLeftovers ? `Réessayer l’envoi (${count})` : 'Envoyer'
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
    addImgFallback(img, figure)

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

function setSelectedFiles (files) {
  selectedFiles = files
  syncInputFiles()
  renderPreview()
}

// Each tap on the dropzone opens a fresh native picker that replaces
// FileList entirely (especially on iOS) — merge instead of replacing, so
// reopening it to add one more photo doesn't silently drop what was
// already chosen.
photosInput.addEventListener('change', async () => {
  const existingKeys = new Set(selectedFiles.map(fileKey))
  const toAdd = Array.from(photosInput.files).filter((file) => !existingKeys.has(fileKey(file)))
  if (toAdd.length === 0) return

  // Conversion can take a couple of seconds per HEIC photo — say so, since
  // renderPreview() below would otherwise be the only feedback and it
  // doesn't run until every file in this batch is done.
  if (toAdd.some(isHeicFile)) dropzoneText.textContent = 'Conversion des photos…'

  for (const file of toAdd) {
    selectedFiles.push(await convertHeicToJpeg(file))
  }
  syncInputFiles()
  renderPreview()
})

renderPreview()

// ── Upload ──────────────────────────────────────────────────────
// Photos go up one per request rather than all in one: a phone batch can
// easily be 50–150 MB, and on venue mobile data one hiccup used to fail the
// whole thing with "Failed to fetch". Each photo gets one attempt in a first
// pass; the ones that failed for a retryable reason (network, 5xx) are then
// retried together at the end, in RETRY_DELAYS_MS.length extra rounds.
// Whatever still fails stays selected, behind a "Réessayer" button.
const RETRY_DELAYS_MS = [2000, 6000]

const uploadProgressText = document.getElementById('upload-progress-text')

function sleep (ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

// Mirrors safeUploadFilename()/uniqueTargetName() in infomaniak/shared.php:
// matches the name(s) the server may have stored this upload under
// ("IMG 01.JPG" → "IMG-01.jpg", or "IMG-01-2.jpg" on a collision).
function serverNamePattern (originalName) {
  const dot = originalName.lastIndexOf('.')
  const rawBase = dot === -1 ? originalName : originalName.slice(0, dot)
  const ext = dot === -1 ? '' : originalName.slice(dot + 1).toLowerCase()
  const base = rawBase.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo'
  const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${base}(-\\d+)?\\.${escapedExt}$`)
}

function applyServerState (data) {
  renderPhotos(data.photos)
  renderQuota(data.remaining, currentMaxPerPerson)
}

async function uploadBatch (files) {
  // Leftovers from a previous batch start out as 'failed', so they skip the
  // first pass and go through the arrival check before being resent.
  const jobs = files.map((file) => ({
    file,
    status: leftovers && leftovers.files.has(file) ? 'failed' : 'pending',
    error: ''
  }))
  const hasLeftovers = jobs.some((j) => j.status === 'failed')
  // Server filenames that existed before this batch, or that a job already
  // accounted for — used to spot a "failed" upload that actually arrived
  // (response lost on the way back), so retrying it doesn't duplicate it.
  const baseline = hasLeftovers ? leftovers.knownPhotos : new Set(lightboxFiles)
  const claimed = new Set()

  function claimArrival (job, photos) {
    const pattern = serverNamePattern(job.file.name)
    const name = photos.find((p) => !baseline.has(p) && !claimed.has(p) && pattern.test(p))
    if (name) claimed.add(name)
    return Boolean(name)
  }

  async function attempt (job) {
    if (currentRemaining <= 0) {
      job.status = 'rejected'
      job.error = `${job.file.name} : limite de ${currentMaxPerPerson} photos par personne atteinte.`
      return
    }
    try {
      const formData = new FormData()
      formData.append('photos[]', job.file)
      const data = await apiFetch('upload.php', { method: 'POST', formData })
      applyServerState(data)
      if (data.uploaded > 0) {
        job.status = 'done'
        claimArrival(job, data.photos)
      } else {
        job.status = 'rejected'
        job.error = data.errors.join(' ')
      }
    } catch (err) {
      if (err.status === 401) throw err
      job.status = err.retryable ? 'failed' : 'rejected'
      job.error = err.retryable ? '' : `${job.file.name} : ${err.message}`
    }
  }

  const pending = jobs.filter((j) => j.status === 'pending')
  for (const [i, job] of pending.entries()) {
    uploadProgressText.textContent = pending.length > 1
      ? `Envoi de la photo ${i + 1} sur ${pending.length}…`
      : 'Envoi de la photo…'
    await attempt(job)
  }

  for (const delay of hasLeftovers ? [0, ...RETRY_DELAYS_MS] : RETRY_DELAYS_MS) {
    let failed = jobs.filter((j) => j.status === 'failed')
    if (failed.length === 0) break
    uploadProgressText.textContent = `Nouvelle tentative pour ${failed.length} photo${failed.length > 1 ? 's' : ''}…`
    await sleep(delay)

    try {
      const me = await apiFetch('me.php')
      applyServerState(me)
      failed.forEach((job) => { if (claimArrival(job, me.photos)) job.status = 'done' })
    } catch (err) {
      if (err.status === 401) throw err
      continue // still offline — don't risk duplicates, wait for the next round
    }

    failed = jobs.filter((j) => j.status === 'failed')
    for (const [i, job] of failed.entries()) {
      uploadProgressText.textContent = `Nouvelle tentative : photo ${i + 1} sur ${failed.length}…`
      await attempt(job)
    }
  }

  const stillFailed = jobs.filter((j) => j.status === 'failed')
  leftovers = stillFailed.length
    ? { files: new Set(stillFailed.map((j) => j.file)), knownPhotos: new Set([...baseline, ...claimed]) }
    : null
  return jobs
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (isUploading || selectedFiles.length === 0) return

  const form = e.target
  const files = selectedFiles.slice()
  isUploading = true
  uploadSubmitBtn.disabled = true
  uploadSubmitBtn.classList.add('is-uploading')
  uploadProgress.hidden = false
  form.setAttribute('aria-busy', 'true')

  try {
    const jobs = await uploadBatch(files)
    const done = jobs.filter((j) => j.status === 'done')
    const rejected = jobs.filter((j) => j.status === 'rejected')
    const failed = jobs.filter((j) => j.status === 'failed')

    const parts = []
    if (done.length) parts.push(`${done.length} photo${done.length > 1 ? 's envoyées' : ' envoyée'}, merci !`)
    rejected.forEach((j) => parts.push(j.error))
    if (failed.length) {
      parts.push(`${failed.length} photo${failed.length > 1 ? 's n’ont' : ' n’a'} pas pu être envoyée${failed.length > 1 ? 's' : ''} (connexion instable). Touchez « Réessayer l’envoi » pour ${failed.length > 1 ? 'les' : 'la'} renvoyer.`)
    }
    toast(parts.join(' '), failed.length === 0 && rejected.length === 0, failed.length ? 8000 : 4000)

    setSelectedFiles(failed.map((j) => j.file))
  } catch (err) {
    // Only a 401 gets here — apiFetch already sent the guest back to the
    // name step. Keep the selection so they can send it once re-identified.
    toast(err.message, false)
  } finally {
    isUploading = false
    uploadSubmitBtn.classList.remove('is-uploading')
    uploadSubmitBtn.disabled = selectedFiles.length === 0
    uploadProgress.hidden = true
    form.removeAttribute('aria-busy')
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
