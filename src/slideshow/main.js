import { loadPhotos } from '../photos.js'

// Meant to run unattended on a projector all evening: advances slowly, and
// re-polls photos-list.php periodically so photos guests upload live (via
// the QR code / guest/ page) join the rotation without anyone touching it.
const DEFAULT_ADVANCE_MS = 7000
const REFRESH_MS = 60000
const DURATION_KEY = 'slideshow_duration_ms'
const STYLE_KEY = 'slideshow_style'
const DEFAULT_STYLE = 'standard'

const stage = document.getElementById('stage')
const emptyEl = document.getElementById('empty')
const menuToggle = document.getElementById('menu-toggle')
const settingsPanel = document.getElementById('settings-panel')
const durationInput = document.getElementById('duration')
const durationValue = document.getElementById('duration-value')
const styleSelect = document.getElementById('style')
const fullscreenBtn = document.getElementById('fullscreen-btn')

let photos = []
let index = -1
let advanceTimer = null
let advanceMs = loadDuration()
let style = loadStyle()

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

function loadStyle () {
  try {
    const stored = localStorage.getItem(STYLE_KEY)
    if (stored === 'standard' || stored === 'polaroid') return stored
  } catch {}
  return DEFAULT_STYLE
}

function saveStyle (value) {
  try {
    localStorage.setItem(STYLE_KEY, value)
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

function preload (src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

// ── Standard renderer: full-bleed photo cross-fading over a blurred copy
// of itself (fills the object-fit:contain letterbox gaps). ──────────────
function makeStandardRenderer () {
  const view = document.getElementById('view-standard')
  const slideA = document.getElementById('slide-a')
  const slideB = document.getElementById('slide-b')
  const bgA = document.getElementById('bg-a')
  const bgB = document.getElementById('bg-b')
  let a = true

  return {
    view,
    init (photo) {
      a = true
      slideB.classList.remove('is-active')
      bgB.classList.remove('is-active')
      slideA.src = photo.src
      slideA.alt = photo.alt
      slideA.classList.add('is-active')
      bgA.style.backgroundImage = `url("${photo.src}")`
      bgA.classList.add('is-active')
    },
    goTo (photo) {
      const nextSlide = a ? slideB : slideA
      const activeSlide = a ? slideA : slideB
      const nextBg = a ? bgB : bgA
      const activeBg = a ? bgA : bgB

      nextSlide.src = photo.src
      nextSlide.alt = photo.alt
      nextSlide.classList.add('is-active')
      activeSlide.classList.remove('is-active')

      nextBg.style.backgroundImage = `url("${photo.src}")`
      nextBg.classList.add('is-active')
      activeBg.classList.remove('is-active')

      a = !a
    },
  }
}

// A small random lean per photo — same spirit as the gallery's polaroid
// scatter, just one card at a time here instead of a whole grid.
function randomTilt () {
  return (Math.random() * 10 - 5).toFixed(2) + 'deg'
}

// Jumps a card off-screen with no transition (so it doesn't visibly fly
// there), then forces a reflow before re-enabling the transition — without
// that reflow, the browser can coalesce the "teleport" and the animated
// move into one no-op instead of animating from the off-screen position.
function placeOffscreen (el, side) {
  el.style.transition = 'none'
  el.style.setProperty('--x', side === 'right' ? '130vw' : '-130vw')
  void el.offsetWidth
  el.style.transition = ''
}

// ── Polaroid renderer: one card at a time, slid across like printed
// photos being pulled out from under the next. ──────────────────────────
function makePolaroidRenderer () {
  const view = document.getElementById('view-polaroid')
  const cardA = document.getElementById('polaroid-a')
  const cardB = document.getElementById('polaroid-b')
  const imgA = document.getElementById('polaroid-img-a')
  const imgB = document.getElementById('polaroid-img-b')
  let a = true

  return {
    view,
    init (photo) {
      a = true
      imgA.src = photo.src
      imgA.alt = photo.alt
      cardA.style.setProperty('--tilt', randomTilt())
      placeOffscreen(cardA, 'right')
      requestAnimationFrame(() => cardA.style.setProperty('--x', '0px'))
    },
    goTo (photo, delta) {
      const enterSide = delta < 0 ? 'left' : 'right'
      const exitSide = delta < 0 ? 'right' : 'left'

      const nextImg = a ? imgB : imgA
      const incoming = a ? cardB : cardA
      const outgoing = a ? cardA : cardB

      nextImg.src = photo.src
      nextImg.alt = photo.alt

      incoming.style.setProperty('--tilt', randomTilt())
      placeOffscreen(incoming, enterSide)

      requestAnimationFrame(() => {
        incoming.style.setProperty('--x', '0px')
        outgoing.style.setProperty('--x', exitSide === 'right' ? '130vw' : '-130vw')
      })

      a = !a
    },
  }
}

const renderers = {
  standard: makeStandardRenderer(),
  polaroid: makePolaroidRenderer(),
}

function currentRenderer () { return renderers[style] }

function applyStyle (value) {
  style = value
  stage.dataset.style = style
}

async function goTo (delta) {
  if (!photos.length) return
  index = (index + delta + photos.length) % photos.length
  const photo = photos[index]
  await preload(photo.src)
  currentRenderer().goTo(photo, delta)
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

styleSelect.value = style
styleSelect.addEventListener('change', () => {
  applyStyle(styleSelect.value)
  saveStyle(style)
  if (photos.length) currentRenderer().init(photos[index])
  resetTimer()
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
  applyStyle(style)
  await refreshPhotos()
  if (photos.length) {
    index = 0
    currentRenderer().init(photos[0])
  }
  resetTimer()
  setInterval(refreshPhotos, REFRESH_MS)
}

init()
