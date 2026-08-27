import { loadPhotos } from '../photos.js'

// Meant to run unattended on a projector all evening: advances slowly, and
// re-polls photos-list.php periodically so photos guests upload live (via
// the QR code / guest/ page) join the rotation without anyone touching it.
const ADVANCE_MS = 7000
const REFRESH_MS = 60000

const slideA = document.getElementById('slide-a')
const slideB = document.getElementById('slide-b')
const emptyEl = document.getElementById('empty')

let photos = []
let index = -1
let showingA = true
let advanceTimer = null

function activeEl () { return showingA ? slideA : slideB }
function nextEl () { return showingA ? slideB : slideA }

function preload (src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

async function advance () {
  if (!photos.length) return
  index = (index + 1) % photos.length
  const photo = photos[index]
  await preload(photo.src)

  const next = nextEl()
  next.src = photo.src
  next.alt = photo.alt
  next.classList.add('is-active')
  activeEl().classList.remove('is-active')
  showingA = !showingA
}

function resetTimer () {
  clearInterval(advanceTimer)
  advanceTimer = setInterval(advance, ADVANCE_MS)
}

async function refreshPhotos () {
  const fresh = await loadPhotos()
  if (fresh.length) {
    photos = fresh
    emptyEl.hidden = true
  } else if (!photos.length) {
    emptyEl.hidden = false
  }
}

async function init () {
  await refreshPhotos()
  if (photos.length) {
    index = 0
    activeEl().src = photos[0].src
    activeEl().alt = photos[0].alt
  }
  resetTimer()
  setInterval(refreshPhotos, REFRESH_MS)

  // Browsers require a user gesture to enter fullscreen — a projector
  // operator can just tap/click once after loading the page.
  document.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  })
}

init()
