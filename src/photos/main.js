import { API_BASE_URL, PHOTOS_BASE_URL } from '../photos.js'
import '../site-swipe-nav.js'

// Guest photo upload, served from github.io but talking to the Cloudflare
// Worker in cloudflare/ (see cloudflare/src/routes/guest.js). A guest's
// identity is a bearer token in localStorage (guest id + HMAC signature,
// verified server-side) rather than a cookie: cross-site cookies get
// silently blocked by some browsers' privacy modes. Per-browser identity:
// switching devices still goes through the "Oui, c'est moi" collision flow.
const API = API_BASE_URL + 'guest/'
const TOKEN_KEY = 'lm_guest_token'
const IMG_BASE = PHOTOS_BASE_URL + 'Invités/'

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
  // A success status that isn't our JSON: a PHP crash page, a venue Wi-Fi
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
    const data = await apiFetch('identify', { method: 'POST', json: { name } })
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
    const data = await apiFetch('identify', { method: 'POST', json: { confirm_name: pendingName } })
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
        const data = await apiFetch('delete', { method: 'POST', json: { file } })
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
// From /guest/me when the server sends it; the Worker currently doesn't, so
// this fallback is the effective client-side limit.
let currentMaxFileBytes = 15 * 1024 * 1024
function guestImgBase () { return IMG_BASE + encodeURIComponent(currentGuestName) + '/' }

function applyLimits (data) {
  currentGuestName = data.name
  currentMaxPerPerson = data.maxPerPerson
  if (data.maxFileBytes) currentMaxFileBytes = data.maxFileBytes
}

async function refreshMyPhotos () {
  const data = await apiFetch('me')
  applyLimits(data)
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
// automatic retries (they stay selected), each mapped to whether an attempt
// may have reached the server anyway, plus the server filenames already
// accounted for at that point — so the next send can first check whether any
// of them actually arrived (see uploadBatch()). null when there are none.
let leftovers = null

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
  const onlyLeftovers = leftovers && count > 0 && selectedFiles.every((f) => leftovers.files.has(f))
  uploadSubmitBtn.textContent = onlyLeftovers ? `Réessayer l’envoi (${count})` : 'Envoyer'
  dropzoneText.textContent = count === 0
    ? 'Touchez pour choisir des photos'
    : `${count} photo${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''} — touchez pour en ajouter`

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
function sendPhoto (file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
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
  renderPhotos(data.photos)
  renderQuota(data.remaining, currentMaxPerPerson)
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
      const data = await sendPhoto(job.file, (fraction) => showBar(settledBytes + fraction * job.file.size))
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
      if (err.retryable) job.maybeSent = true
    }
  }

  let gaveUp = false
  for (const [i, job] of jobs.entries()) {
    if (gaveUp) {
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
      if (retry === RETRY_DELAYS_MS.length) {
        gaveUp = true
        break
      }

      showBar(settledBytes)
      uploadProgressDetail.textContent = 'Connexion instable, nouvelle tentative dans quelques secondes…'
      await sleep(jittered(RETRY_DELAYS_MS[retry]))
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
    if (done.length) parts.push(`${done.length} photo${done.length > 1 ? 's envoyées' : ' envoyée'}, merci !`)
    rejected.forEach((j) => parts.push(j.error))
    if (failed.length) {
      const plural = failed.length > 1
      parts.push(`${failed.length} photo${plural ? 's n’ont' : ' n’a'} pas encore pu être envoyée${plural ? 's' : ''} (connexion instable). ${plural ? 'Elles restent sélectionnées' : 'Elle reste sélectionnée'} : l’envoi reprendra automatiquement au retour de la connexion, ou touchez « Réessayer l’envoi ».`)
    }
    toast(parts.join(' '), failed.length === 0 && rejected.length === 0, failed.length ? 10000 : 4000)

    setSelectedFiles(failed.map((j) => j.file))
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
function resumeLeftovers () {
  if (isUploading || !leftovers || !navigator.onLine || uploadStep.hidden) return
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
    const data = await apiFetch('me')
    applyLimits(data)
    showUploadStep(data.name)
    renderQuota(data.remaining, data.maxPerPerson)
    renderPhotos(data.photos)
  } catch {
    showNameStep()
  }
}

init()
