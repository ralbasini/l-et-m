import { loadPhotos } from '../photos.js'

// Same idea as src/slideshow/ (unattended projector display, live-refreshing
// from guest uploads), but each photo is shown as a single polaroid card
// instead of full-bleed with a blurred backdrop.
const DEFAULT_ADVANCE_MS = 7000
const REFRESH_MS = 60000
const DURATION_KEY = 'slideshow_duration_ms'

const polaroidA = document.getElementById('polaroid-a')
const polaroidB = document.getElementById('polaroid-b')
const slideA = document.getElementById('slide-a')
const slideB = document.getElementById('slide-b')
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

function activePolaroid () { return showingA ? polaroidA : polaroidB }
function nextPolaroid () { return showingA ? polaroidB : polaroidA }
function activeImg () { return showingA ? slideA : slideB }
function nextImg () { return showingA ? slideB : slideA }

function preload (src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

// A small random lean per photo — same spirit as the gallery's polaroid
// scatter, just one card at a time here instead of a whole grid.
function randomTilt () {
  return (Math.random() * 10 - 5).toFixed(2) + 'deg'
}

async function goTo (delta) {
  if (!photos.length) return
  index = (index + delta + photos.length) % photos.length
  const photo = photos[index]
  await preload(photo.src)

  const img = nextImg()
  img.src = photo.src
  img.alt = photo.alt

  const card = nextPolaroid()
  card.style.setProperty('--tilt', randomTilt())
  card.classList.add('is-active')
  activePolaroid().classList.remove('is-active')

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

let touchStartX = 0
document.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX }, { passive: true })
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX
  if (Math.abs(dx) < 40) return
  goTo(dx < 0 ? 1 : -1)
  resetTimer()
}, { passive: true })

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

document.querySelector('.stage').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
})

async function init () {
  await refreshPhotos()
  if (photos.length) {
    index = 0
    activeImg().src = photos[0].src
    activeImg().alt = photos[0].alt
    activePolaroid().style.setProperty('--tilt', randomTilt())
  }
  resetTimer()
  setInterval(refreshPhotos, REFRESH_MS)
}

init()
