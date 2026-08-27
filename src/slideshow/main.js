import { loadPhotos } from '../photos.js'

// Meant to run unattended on a projector all evening: advances slowly, and
// re-polls photos-list.php periodically so photos guests upload live (via
// the QR code / guest/ page) join the rotation without anyone touching it.
const DEFAULT_ADVANCE_MS = 7000
const REFRESH_MS = 60000
const DURATION_KEY = 'slideshow_duration_ms'

const stage = document.querySelector('.stage')
const slideA = document.getElementById('slide-a')
const slideB = document.getElementById('slide-b')
const bgA = document.getElementById('bg-a')
const bgB = document.getElementById('bg-b')
const emptyEl = document.getElementById('empty')
const menuToggle = document.getElementById('menu-toggle')
const settingsPanel = document.getElementById('settings-panel')
const durationInput = document.getElementById('duration')
const durationValue = document.getElementById('duration-value')
const fullscreenBtn = document.getElementById('fullscreen-btn')

let photos = []
let index = -1
let showingA = true
let advanceTimer = null
let advanceMs = loadDuration()

function loadDuration () {
  try {
    const stored = parseInt(localStorage.getItem(DURATION_KEY), 10)
    if (!isNaN(stored) && stored >= 3000) return stored
  } catch {}
  return DEFAULT_ADVANCE_MS
}

function saveDuration (ms) {
  try {
    localStorage.setItem(DURATION_KEY, String(ms))
  } catch {}
}

function shuffle (list) {
  const copy = list.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function activeEl () { return showingA ? slideA : slideB }
function nextEl () { return showingA ? slideB : slideA }
function activeBg () { return showingA ? bgA : bgB }
function nextBg () { return showingA ? bgB : bgA }

function preload (src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

async function goTo (delta) {
  if (!photos.length) return
  index = (index + delta + photos.length) % photos.length
  const photo = photos[index]
  await preload(photo.src)

  const next = nextEl()
  next.src = photo.src
  next.alt = photo.alt
  next.classList.add('is-active')
  activeEl().classList.remove('is-active')

  const nextBackground = nextBg()
  nextBackground.style.backgroundImage = `url("${photo.src}")`
  nextBackground.classList.add('is-active')
  activeBg().classList.remove('is-active')

  showingA = !showingA
}

function resetTimer () {
  clearInterval(advanceTimer)
  advanceTimer = setInterval(() => goTo(1), advanceMs)
}

async function refreshPhotos () {
  const fresh = await loadPhotos()
  if (fresh.length) {
    photos = shuffle(fresh)
    emptyEl.hidden = true
  } else if (!photos.length) {
    emptyEl.hidden = false
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') {
    goTo(1)
    resetTimer()
  } else if (e.key === 'ArrowLeft') {
    goTo(-1)
    resetTimer()
  }
})

// The settings menu is meant for setting up the display, not for guests to
// fiddle with mid-projection — it hides itself via CSS (:fullscreen) once
// the page actually goes fullscreen. Clicking the stage itself still enters
// fullscreen too, as a big obvious fallback alongside the explicit button.
menuToggle.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden
})

durationInput.value = String(Math.round(advanceMs / 1000))
durationValue.textContent = durationInput.value + ' s'
durationInput.addEventListener('input', () => {
  advanceMs = parseInt(durationInput.value, 10) * 1000
  durationValue.textContent = durationInput.value + ' s'
  saveDuration(advanceMs)
  resetTimer()
})

fullscreenBtn.addEventListener('click', () => {
  document.documentElement.requestFullscreen?.().catch(() => {})
})

stage.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
})

async function init () {
  await refreshPhotos()
  if (photos.length) {
    index = 0
    activeEl().src = photos[0].src
    activeEl().alt = photos[0].alt
    activeBg().style.backgroundImage = `url("${photos[0].src}")`
  }
  resetTimer()
  setInterval(refreshPhotos, REFRESH_MS)
}

init()
