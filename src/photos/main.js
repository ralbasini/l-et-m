import { API_BASE_URL, photoUrl, loadThumb } from '../photos.js'
import { makeThumbnail } from '../thumbnail.js'
import { toast } from '../toast.js'
import '../site-swipe-nav.js'
import { requireGuest } from '../gate.js'
import { clearSession, getSession, logoutAll } from '../session.js'
import { avatarEl } from '../quiz/avatar.js'
import '../avatar.css'

// Guest photo upload, served from github.io but talking to the Cloudflare
// Worker in cloudflare/ (see cloudflare/src/routes/guest.js). A guest's
// identity is a bearer token in localStorage (guest id + HMAC signature,
// verified server-side) rather than a cookie: cross-site cookies get
// silently blocked by some browsers' privacy modes. Per-browser identity:
// the account (name + avatar) is created on the login screen, src/gate.js, shared with the quiz.
const API = API_BASE_URL + 'guest/'
const TOKEN_KEY = 'lm_guest_token'

function getToken () { return localStorage.getItem(TOKEN_KEY) || '' }
function setToken (token) { localStorage.setItem(TOKEN_KEY, token) }
function clearToken () { clearSession() }

// `retryable` marks failures worth trying again as-is: the connection
// dropped, or the server/proxy was overloaded (5xx, 408, 429). Note that a
// raw fetch() "Failed to fetch" TypeError also covers errors produced before
// the Worker runs (proxy 413/502/504…) — those carry no CORS headers, so the
// browser hides them behind a generic network error.
class ApiError extends Error {
  constructor (message, { status = 0, retryable = false } = {}) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

// Without a deadline, a request sent into a connection that silently died
// can wait forever (photo uploads have their own stall detection instead —
// see sendPhoto()).
const REQUEST_TIMEOUT_MS = 30000

function networkError () {
  return new ApiError('Connexion au serveur impossible, vérifiez votre réseau.', { retryable: true })
}

// Shared by apiFetch() and sendPhoto(): turns an HTTP status + parsed JSON
// body (null if it wasn't JSON) into the data, or a thrown ApiError.
function checkResponse (status, data) {
  if (status === 401) {
    clearToken()
    showNameStep()
    throw new ApiError('Session expirée, merci de recommencer.', { status: 401 })
  }
  if (status < 200 || status >= 300) {
    throw new ApiError((data && data.error) || 'Une erreur est survenue.', {
      status,
      retryable: status >= 500 || status === 408 || status === 429
    })
  }
  // A success status that isn't our JSON: a proxy error page, a venue Wi-Fi
  // login portal answering in the server's place… worth another try.
  if (data === null) {
    throw new ApiError('Réponse inattendue du serveur.', { status, retryable: true })
  }
  return data
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

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res
  let data = null
  try {
    res = await fetch(API + path, { method, headers, body, signal: controller.signal })
    try { data = await res.json() } catch {}
  } catch {
    throw networkError()
  } finally {
    clearTimeout(timer)
  }

  return checkResponse(res.status, data)
}

// ── Steps ─────────────────────────────────────────────────────
const uploadStep = document.getElementById('upload-step')
const myPhotosCard = document.getElementById('my-photos')

// "Logged out": the login screen (name + avatar) takes over until there is an account.
function showNameStep () {
  document.getElementById('profile-card').hidden = true
  uploadStep.hidden = true
  myPhotosCard.hidden = true
  requireGuest().then((s) => enterUploadStep(s.name)).catch(() => {})
}

// The profile card: avatar and name, change the avatar, log out.
function renderProfile () {
  const { name, avatar } = getSession()
  const card = document.getElementById('profile-card')
  document.getElementById('profile-name').textContent = name
  document.getElementById('profile-avatar').replaceChildren(...(avatar ? [avatarEl(avatar)] : []))
  card.hidden = false
}
document.getElementById('profile-edit').addEventListener('click', async () => {
  try {
    await requireGuest({ edit: true })
    window.top.location.reload() // every panel picks up the new avatar
  } catch { /* cancelled */ }
})
document.getElementById('profile-exit').addEventListener('click', logoutAll)

function showUploadStep (guestName) {
  renderProfile()
  uploadStep.hidden = false
  myPhotosCard.hidden = false
}

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
    full.textContent = `Vous avez atteint la limite de ${maxPerPerson} photos, merci beaucoup !`
  } else {
    form.hidden = false
    full.hidden = true
    label.textContent = `${remaining} photo${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''} sur ${maxPerPerson}`
    // The bar shows what's used so far: full = no photos left.
    const used = Math.max(0, maxPerPerson - remaining)
    const bar = document.getElementById('quota-bar')
    bar.setAttribute('aria-valuemax', String(maxPerPerson))
    bar.setAttribute('aria-valuenow', String(used))
    document.getElementById('quota-bar-fill').style.width = `${(100 * used) / maxPerPerson}%`
  }
}

function renderPhotos (photos, pending = []) {
  const grid = document.getElementById('photos-grid')
  grid.innerHTML = ''
  myPhotosCard.hidden = photos.length === 0
  lightboxFiles = photos

  photos.forEach((file, i) => {
    const figure = document.createElement('figure')

    const img = document.createElement('img')
    loadThumb(img, guestPhotoPath(file))
    img.alt = ''
    img.loading = 'lazy'
    img.addEventListener('click', () => openLightbox(i))
    figure.appendChild(img)
    if (pending.includes(file)) {
      const badge = document.createElement('span')
      badge.className = 'pending-tag'
      badge.textContent = 'En attente de validation'
      figure.appendChild(badge)
    }

    const delBtn = document.createElement('button')
    delBtn.type = 'button'
    delBtn.className = 'delete-btn'
    delBtn.setAttribute('aria-label', 'Supprimer')
    delBtn.textContent = '×'
    delBtn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette photo ?')) return
      try {
        const data = await apiFetch('delete', { method: 'POST', json: { file } })
        toast('Photo supprimée.', true)
        notifyGalleryStale()
        renderPhotos(data.photos, data.pending)
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
let currentMaxPerPerson = 10
// From /guest/me when the server sends it; the Worker currently doesn't, so
// this fallback is the effective client-side limit.
let currentMaxFileBytes = 15 * 1024 * 1024
function guestPhotoPath (file) { return `Invités/${currentGuestName}/${file}` }
function guestPhotoUrl (file) { return photoUrl(guestPhotoPath(file)) }

function applyLimits (data) {
  currentGuestName = data.name
  currentMaxPerPerson = data.maxPerPerson
  if (data.maxFileBytes) currentMaxFileBytes = data.maxFileBytes
}

async function refreshMyPhotos () {
  const data = await apiFetch('me')
  applyLimits(data)
  renderQuota(data.remaining, data.maxPerPerson)
  renderPhotos(data.photos, data.pending)
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
const previewError = document.getElementById('preview-error')
const uploadSubmitBtn = document.getElementById('upload-submit')
const uploadProgress = document.getElementById('upload-progress')

let selectedFiles = []
let previewUrls = []
let currentRemaining = 10
let isUploading = false
// Photos from the last batch that still couldn't be sent after the
// automatic retries (they stay selected), each mapped to whether an attempt
// may have reached the server anyway, plus the server filenames already
// accounted for at that point — so the next send can first check whether any
// of them actually arrived (see uploadBatch()). null when there are none.
let leftovers = null

function fileKey (file) {
  return [file.name, file.size, file.lastModified].join('|')
}

function syncInputFiles () {
  // Only a courtesy (the input shows its own "N files" text): the selection lives in selectedFiles,
  // so a browser that can't build a FileList (or refuses to assign it) must not break the page.
  try {
    const dt = new DataTransfer()
    selectedFiles.forEach((file) => dt.items.add(file))
    photosInput.files = dt.files
  } catch { /* keep going with selectedFiles */ }
}
// "required" would block the form unless the input itself holds a FileList; we check selectedFiles.
photosInput.required = false

// Photos that can never be sent (the phone cannot read or show them) are not kept in the list of
// photos ready to send: they are named here instead, with the reason.
let rejectedPhotos = []
function rejectPhoto (name, reason) {
  rejectedPhotos.push(`${name} : ${reason}`)
  previewError.hidden = false
  previewError.textContent = (rejectedPhotos.length > 1 ? 'Ces photos ne peuvent pas être envoyées. ' : 'Cette photo ne peut pas être envoyée. ') + rejectedPhotos.join(' — ')
}
function clearRejected () {
  rejectedPhotos = []
  previewError.hidden = true
  previewError.textContent = ''
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
  // Only shown once there is something to send.
  uploadSubmitBtn.hidden = count === 0
  const onlyLeftovers = leftovers && count > 0 && selectedFiles.every((f) => leftovers.files.has(f))
  uploadSubmitBtn.textContent = onlyLeftovers ? `Réessayer l’envoi (${count})` : 'Envoyer'
  dropzoneText.textContent = count === 0
    ? 'Choisir des photos'
    : `${count} photo${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''} — en ajouter d’autres`

  const warnings = []
  if (count > currentRemaining) {
    warnings.push(`Seules les ${currentRemaining} première${currentRemaining > 1 ? 's' : ''} seront envoyées (il n'en reste que ${currentRemaining}).`)
  }
  const tooBig = selectedFiles.filter((f) => f.size > currentMaxFileBytes).length
  if (tooBig) {
    warnings.push(`${tooBig > 1 ? `${tooBig} photos dépassent` : 'Une photo dépasse'} la taille maximale de ${formatMb(currentMaxFileBytes)} Mo et ne ${tooBig > 1 ? 'pourront' : 'pourra'} pas être envoyée${tooBig > 1 ? 's' : ''}.`)
  }
  previewWarning.hidden = warnings.length === 0
  previewWarning.textContent = warnings.join(' ')

  selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file)
    previewUrls.push(url)

    // Dotted border + clock badge: selected, not sent yet.
    const figure = document.createElement('figure')
    figure.className = 'is-pending'
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.addEventListener('click', () => openLightbox(i, true))
    // A picture this browser cannot show (an unsupported format, a damaged file) is dropped from the list.
    img.addEventListener('error', async () => {
      // First try another way of decoding it (some JPEG variants only open through the bitmap decoder).
      if (!img.dataset.retried) {
        img.dataset.retried = '1'
        try {
          const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
          const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          bitmap.close()
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
          if (blob) {
            const alt = URL.createObjectURL(blob)
            previewUrls.push(alt)
            img.src = alt
            return
          }
        } catch { /* fall through to the name tile */ }
      }
      // Still no picture: it cannot be previewed, so it will never be sendable. Take it out of the list
      // of photos ready to send and say so.
      const at = selectedFiles.indexOf(file)
      if (at !== -1) selectedFiles.splice(at, 1)
      rejectPhoto(file.name, 'format d’image non reconnu par ce navigateur, elle ne pourra pas être envoyée.')
      syncInputFiles()
      renderPreview()
    })
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
// HEIC (iPhone photos, some Samsung settings) can only be shown by Safari. Anywhere else the preview is
// broken, the gallery could not show the photo either, and some Android browsers even send it with no
// type. So where the browser cannot decode it, it is converted to a high-quality JPEG first (a library
// loaded only for that case); if the conversion fails the original is still sent as it is.
const looksHeic = (file) => /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)
const TYPE_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif' }

// A photo handed over by the phone's picker (WhatsApp, Google Photos, the gallery…) is only a pointer to
// a file that Android or iOS reads on demand: it can turn out unreadable, vanish, or have no type or
// the wrong extension (a HEIC saved as ".jpg" is common). So each photo is read once, right away, into
// memory: an unreadable one is reported now instead of failing mid-upload, and the rest of the page
// works on a stable copy. Its real format is checked from its first bytes.
async function readableFile (file) {
  let buffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    rejectPhoto(file.name, 'le téléphone n’arrive pas à la lire. Enregistrez-la d’abord dans la galerie, puis choisissez-la à nouveau.')
    return null
  }
  if (buffer.byteLength === 0) {
    rejectPhoto(file.name, 'le fichier est vide ou n’a pas fini de se télécharger.')
    return null
  }
  const head = new Uint8Array(buffer, 0, 12)
  const brand = String.fromCharCode(...head.slice(4, 12))
  const isHeic = /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brand)
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  let type = file.type || TYPE_BY_EXT[ext] || ''
  let name = file.name
  if (isHeic) {
    type = 'image/heic'
    if (!/\.hei[cf]$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.heic'
  }
  const copy = new File([buffer], name, { type, lastModified: file.lastModified })
  if (!(isHeic || looksHeic(copy))) return copy

  // HEIC: only Safari can show it. Elsewhere convert it to a high-quality JPEG (library loaded just now).
  const canShow = await createImageBitmap(copy).then((b) => { b.close(); return true }, () => false)
  if (canShow) return copy
  try {
    toast('Conversion de la photo…', true)
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: copy, toType: 'image/jpeg', quality: 0.95 })
    const blob = Array.isArray(out) ? out[0] : out
    return new File([blob], name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return copy
  }
}

photosInput.addEventListener('change', async () => {
  clearRejected()
  const existingKeys = new Set(selectedFiles.map(fileKey))
  let added = 0
  const picked = await Promise.all(Array.from(photosInput.files).map(async (f) => ({ key: fileKey(f), file: await readableFile(f) })))
  picked.forEach(({ key, file }) => {
    if (file && !existingKeys.has(key)) {
      selectedFiles.push(file)
      existingKeys.add(key)
      added += 1
    }
  })
  syncInputFiles()
  renderPreview()
  // Bring "Envoyer" into view so the next step is obvious — centered, so
  // the fixed menu bar can't cover it.
  if (added > 0) {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    uploadSubmitBtn.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
  }
})

renderPreview()

// ── Upload ──────────────────────────────────────────────────────
// Photos go up untouched (full original quality — they may be printed),
// one per request and one at a time: a phone batch can easily be 50–150 MB,
// and on venue mobile data one hiccup used to fail the whole thing with
// "Failed to fetch". Each photo is retried in place, automatically, with
// growing pauses (RETRY_DELAYS_MS, ~4 min in all), waiting out a lost
// connection or a locked phone without using up attempts. Before resending,
// the server is asked whether the "failed" photo actually arrived (response
// lost on the way back), so a retry never duplicates it. Only if a photo
// still can't get through does the batch stop; what's left stays selected
// and is resumed on its own once the connection comes back or the guest
// returns to the page — or by hand, with the "Réessayer" button.
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000, 45000, 60000, 60000]
// A transfer that makes no progress for this long is abandoned and retried,
// so a connection that silently died mid-upload can't hang forever. Also
// bounds the wait for the server's answer once every byte is sent.
const STALL_TIMEOUT_MS = 60000
// How long a batch waits for a phone that reports being offline before
// giving up for now (it then resumes by itself on the 'online' event).
const OFFLINE_WAIT_MS = 5 * 60000

const uploadProgressText = document.getElementById('upload-progress-text')
const uploadProgressDetail = document.getElementById('upload-progress-detail')
const uploadBarFill = document.getElementById('upload-bar-fill')

function sleep (ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

// "Annuler" while an upload is running or waiting to retry: stops the request in flight, wakes any
// wait, and the photos not sent yet simply stay selected.
let cancelUpload = false
let currentXhr = null
let wakeUp = null
function interruptibleSleep (ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { wakeUp = null; resolve() }, ms)
    wakeUp = () => { clearTimeout(timer); wakeUp = null; resolve() }
  })
}
document.getElementById('upload-cancel').addEventListener('click', () => {
  cancelUpload = true
  if (currentXhr) currentXhr.abort()
  if (wakeUp) wakeUp()
})

// ±30%, so guests whose uploads failed together (e.g. the server was
// briefly saturated) don't all come back in lockstep.
function jittered (ms) { return ms * (0.7 + Math.random() * 0.6) }

// Resolves true once the browser reports a connection again, false if
// maxMs passes first.
function whenOnline (maxMs) {
  if (navigator.onLine) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (value) => {
      window.removeEventListener('online', onOnline)
      clearTimeout(timer)
      resolve(value)
    }
    const onOnline = () => done(true)
    const timer = setTimeout(() => done(navigator.onLine), maxMs)
    window.addEventListener('online', onOnline)
  })
}

// A hidden page (locked phone, other app) gets its network requests
// suspended or killed, so there's no point retrying until it's back.
function whenVisible () {
  if (document.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', onChange)
      resolve()
    }
    document.addEventListener('visibilitychange', onChange)
  })
}

// Keeps the phone from auto-locking mid-batch, which would suspend the page
// and kill the transfer. Browsers drop the lock whenever the page is
// hidden, so it's re-requested on return (see visibilitychange below).
// Unsupported browsers just skip it.
let wakeLock = null
async function keepScreenOn () {
  try { wakeLock = await navigator.wakeLock.request('screen') } catch {}
}
function allowScreenOff () {
  if (wakeLock) wakeLock.release().catch(() => {})
  wakeLock = null
}

function formatMb (bytes) { return Math.round(bytes / (1024 * 1024)) }

// XMLHttpRequest rather than fetch() for this one call: fetch() can't
// report upload progress, which drives both the progress bar and the
// stall detection.
function sendPhoto (file, thumb, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    currentXhr = xhr
    let stallTimer
    const armStallTimer = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => xhr.abort(), STALL_TIMEOUT_MS)
    }
    const fail = () => {
      clearTimeout(stallTimer)
      reject(networkError())
    }

    xhr.open('POST', API + 'upload')
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.upload.onprogress = (e) => {
      armStallTimer()
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onprogress = armStallTimer
    xhr.onerror = fail
    xhr.onabort = fail
    xhr.ontimeout = fail
    xhr.onload = () => {
      clearTimeout(stallTimer)
      let data = null
      try { data = JSON.parse(xhr.responseText) } catch {}
      try {
        resolve(checkResponse(xhr.status, data))
      } catch (err) {
        reject(err)
      }
    }

    const formData = new FormData()
    formData.append('photos[]', file)
    if (thumb) formData.append('thumb', thumb, 'thumb.jpg')
    armStallTimer()
    xhr.send(formData)
  })
}

// Mirrors safeFilename()/uniqueFilename() in cloudflare/src/files.js:
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
  renderPhotos(data.photos, data.pending)
  renderQuota(data.remaining, currentMaxPerPerson)
}

// When embedded in the home page's panels, the galerie iframe is loaded once
// and never reloaded — tell the shell to refresh it so the change shows up.
function notifyGalleryStale () {
  if (window.parent !== window) window.parent.postMessage({ type: 'gallery-stale' }, location.origin)
}

async function uploadBatch (files) {
  const jobs = files.map((file) => ({
    file,
    status: 'pending',
    error: '',
    // Whether an earlier attempt may have reached the server despite
    // failing on our side — if so, check before resending.
    maybeSent: Boolean(leftovers && leftovers.files.get(file))
  }))
  // Server filenames that existed before this batch, or that a job already
  // accounted for — used to spot a "failed" upload that actually arrived
  // (response lost on the way back), so retrying it doesn't duplicate it.
  const baseline = leftovers ? leftovers.knownPhotos : new Set(lightboxFiles)
  const claimed = new Set()

  function claimArrival (job, photos) {
    const pattern = serverNamePattern(job.file.name)
    const name = photos.find((p) => !baseline.has(p) && !claimed.has(p) && pattern.test(p))
    if (name) claimed.add(name)
    return Boolean(name)
  }

  const totalBytes = jobs.reduce((sum, j) => sum + j.file.size, 0) || 1
  let settledBytes = 0
  const showBar = (bytes) => {
    uploadBarFill.style.width = `${Math.min(100, (100 * bytes) / totalBytes)}%`
  }
  showBar(0)

  // true/false once the server answered, null if it's still unreachable.
  async function checkArrived (job) {
    try {
      const me = await apiFetch('me')
      applyServerState(me)
      return claimArrival(job, me.photos)
    } catch (err) {
      if (err.status === 401) throw err
      return null
    }
  }

  async function attempt (job) {
    if (job.file.size > currentMaxFileBytes) {
      job.status = 'rejected'
      job.error = `${job.file.name} : fichier trop volumineux (maximum ${formatMb(currentMaxFileBytes)} Mo).`
      return
    }
    if (currentRemaining <= 0) {
      job.status = 'rejected'
      job.error = `${job.file.name} : limite de ${currentMaxPerPerson} photos par personne atteinte.`
      return
    }
    try {
      if (job.thumb === undefined) job.thumb = await makeThumbnail(job.file) // once, kept across retries
      const data = await sendPhoto(job.file, job.thumb, (fraction) => showBar(settledBytes + fraction * job.file.size))
      applyServerState(data)
      if (data.uploaded > 0) {
        job.status = 'done'
        notifyGalleryStale()
        claimArrival(job, data.photos)
      } else {
        job.status = 'rejected'
        job.error = data.errors.join(' ')
      }
    } catch (err) {
      if (err.status === 401) throw err
      job.status = err.retryable ? 'failed' : 'rejected'
      job.error = err.retryable ? '' : `${job.file.name} : ${err.message}`
      if (err.retryable) job.maybeSent = true
    }
  }

  let gaveUp = false
  for (const [i, job] of jobs.entries()) {
    if (gaveUp || cancelUpload) {
      job.status = 'failed' // kept for the next resume
      continue
    }
    uploadProgressText.textContent = jobs.length > 1
      ? `Envoi de la photo ${i + 1} sur ${jobs.length}…`
      : 'Envoi de la photo…'
    uploadProgressDetail.textContent = ''

    for (let retry = 0; ; retry++) {
      if (job.maybeSent) {
        const arrived = await checkArrived(job)
        if (arrived) {
          job.status = 'done'
        } else if (arrived === null) {
          job.status = 'failed'
        } else {
          await attempt(job)
        }
      } else {
        await attempt(job)
      }
      if (job.status !== 'failed') break
      if (cancelUpload) { gaveUp = true; break }
      if (retry === RETRY_DELAYS_MS.length) {
        gaveUp = true
        break
      }

      showBar(settledBytes)
      uploadProgressDetail.textContent = 'Connexion instable, nouvelle tentative dans quelques secondes…'
      await interruptibleSleep(jittered(RETRY_DELAYS_MS[retry]))
      if (cancelUpload) { gaveUp = true; break }
      if (!navigator.onLine) {
        uploadProgressDetail.textContent = 'Pas de réseau pour le moment. L’envoi reprendra tout seul dès son retour.'
        if (!await whenOnline(OFFLINE_WAIT_MS)) {
          gaveUp = true
          break
        }
      }
      await whenVisible()
      uploadProgressDetail.textContent = 'Nouvelle tentative…'
    }

    settledBytes += job.file.size
    showBar(settledBytes)
  }

  const stillFailed = jobs.filter((j) => j.status === 'failed')
  leftovers = stillFailed.length
    ? {
        files: new Map(stillFailed.map((j) => [j.file, j.maybeSent])),
        knownPhotos: new Set([...baseline, ...claimed])
      }
    : null
  return jobs
}

async function runUpload () {
  if (isUploading || selectedFiles.length === 0) return

  const form = document.getElementById('upload-form')
  const files = selectedFiles.slice()
  cancelUpload = false
  resumePaused = false
  isUploading = true
  uploadSubmitBtn.disabled = true
  uploadSubmitBtn.classList.add('is-uploading')
  uploadProgress.hidden = false
  form.setAttribute('aria-busy', 'true')
  keepScreenOn()

  try {
    const jobs = await uploadBatch(files)
    const done = jobs.filter((j) => j.status === 'done')
    const rejected = jobs.filter((j) => j.status === 'rejected')
    const failed = jobs.filter((j) => j.status === 'failed')

    const parts = []
    if (done.length) parts.push(`${done.length} photo${done.length > 1 ? 's envoyées' : ' envoyée'}, merci ! Elle${done.length > 1 ? 's apparaîtront' : ' apparaîtra'} dans la galerie après validation.`)
    rejected.forEach((j) => parts.push(j.error))
    if (failed.length) {
      const plural = failed.length > 1
      parts.push(`${failed.length} photo${plural ? 's n’ont' : ' n’a'} pas encore pu être envoyée${plural ? 's' : ''} (connexion instable). ${plural ? 'Elles restent sélectionnées' : 'Elle reste sélectionnée'} : l’envoi reprendra automatiquement au retour de la connexion, ou touchez « Réessayer l’envoi ».`)
    }
    if (cancelUpload && failed.length) {
      resumePaused = true // the guest stopped it: do not restart on its own
      parts.length = 0
      if (done.length) parts.push(`${done.length} photo${done.length > 1 ? 's envoyées' : ' envoyée'}.`)
      parts.push(`Envoi annulé. ${failed.length > 1 ? 'Les photos restantes restent sélectionnées' : 'La photo restante reste sélectionnée'} : touchez « Envoyer » pour reprendre.`)
    }
    toast(parts.join(' '), failed.length === 0 && rejected.length === 0, failed.length ? 10000 : 4000)

    setSelectedFiles(failed.map((j) => j.file))

    // Show the guest their photos once they're all in. Not while some are
    // still pending: "Réessayer l’envoi" should stay in view then.
    if (done.length && !failed.length && !myPhotosCard.hidden) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      myPhotosCard.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    }
  } catch (err) {
    // Only a 401 gets here — apiFetch already sent the guest back to the
    // name step. Keep the selection so they can send it once re-identified.
    toast(err.message, false)
  } finally {
    isUploading = false
    allowScreenOff()
    uploadSubmitBtn.classList.remove('is-uploading')
    uploadSubmitBtn.disabled = selectedFiles.length === 0
    uploadProgress.hidden = true
    form.removeAttribute('aria-busy')
  }
}

document.getElementById('upload-form').addEventListener('submit', (e) => {
  e.preventDefault()
  runUpload()
})

// Picks a stalled batch back up without the guest having to do anything —
// but only while the selection is still exactly those leftovers; once
// they've added or removed photos, sending is theirs to trigger again.
let resumePaused = false
function resumeLeftovers () {
  if (resumePaused || isUploading || !leftovers || !navigator.onLine || uploadStep.hidden) return
  if (selectedFiles.length === 0 || !selectedFiles.every((f) => leftovers.files.has(f))) return
  runUpload()
}

window.addEventListener('online', resumeLeftovers)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  if (isUploading) keepScreenOn()
  else resumeLeftovers()
})

// Closing or reloading the page mid-batch would drop whatever hasn't gone
// up yet — the browser's own "leave this page?" prompt guards against it.
window.addEventListener('beforeunload', (e) => {
  if (!isUploading) return
  e.preventDefault()
  e.returnValue = ''
})

// ── Lightbox ────────────────────────────────────────────────────
let lightboxFiles = []
const lightbox = document.getElementById('lightbox')
const lightboxImg = document.getElementById('lightbox-img')
const lightboxCount = document.getElementById('lightbox-count')
let lbIndex = 0
// Which list the lightbox browses: uploaded photos or the pending selection
// (object URLs, read live since renderPreview() regenerates them).
let lbPending = false

function lbUrls () {
  return lbPending ? previewUrls : lightboxFiles.map(guestPhotoUrl)
}

function lbShow (i) {
  const urls = lbUrls()
  if (!urls.length) { closeLightbox(); return }
  lbIndex = (i + urls.length) % urls.length
  lightboxImg.src = urls[lbIndex]
  lightboxCount.textContent = `${lbIndex + 1} / ${urls.length}`
}

function openLightbox (i, pending = false) {
  lbPending = pending
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
    const data = await apiFetch('me')
    applyLimits(data)
    showUploadStep(data.name)
    renderQuota(data.remaining, data.maxPerPerson)
    renderPhotos(data.photos, data.pending)
  } catch {
    showNameStep()
  }
}

init()
