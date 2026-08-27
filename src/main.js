const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Photos are hosted outside this repo, in an Infomaniak folder that also
// holds infomaniak/photos-list.php (see that file). It sends its own CORS
// header, so the same URL works from both `npm run dev` and production.
const REMOTE_GALLERY_URL = 'https://ralbasini.ch/l-et-m/'

// ── Photo source ────────────────────────────────────────────────
// No manifest, no images committed to the repo: this asks photos-list.php
// what's currently in the Infomaniak folder. Drop a photo in that folder
// and it shows up on the site on next load — nothing to redeploy.
async function loadPhotos () {
  try {
    const res = await fetch(REMOTE_GALLERY_URL + 'photos-list.php', { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((entry) => {
      const file = typeof entry === 'string' ? entry : entry.file
      const alt = typeof entry === 'string' ? '' : (entry.alt || '')
      return { src: REMOTE_GALLERY_URL + 'img/' + encodeURIComponent(file), alt: alt || 'Photo du mariage de Lobna et Martin' }
    })
  } catch {
    return []
  }
}

// ── Scroll-reveal ───────────────────────────────────────────────
function observeReveal (root = document) {
  const els = root.querySelectorAll('.fade-in:not(.visible)')
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible')
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' })
  els.forEach((el) => observer.observe(el))
}

// ── Starfield (decorative, works with zero photos too) ──────────
function buildStars () {
  const field = document.querySelector('.hero-stars')
  if (!field) return
  const count = 24
  for (let i = 0; i < count; i++) {
    const star = document.createElement('span')
    star.className = 'star'
    star.style.left = Math.random() * 100 + '%'
    star.style.top = Math.random() * 70 + '%'
    star.style.setProperty('--d', (3 + Math.random() * 4).toFixed(2) + 's')
    star.style.setProperty('--delay', (Math.random() * 4).toFixed(2) + 's')
    field.appendChild(star)
  }
}

// ── Slideshow ─────────────────────────────────────────────────
function buildSlideshow (photos) {
  const stage = document.getElementById('slideshow')
  const dotsWrap = document.getElementById('slideshow-dots')
  if (!photos.length) return

  photos.forEach((photo, i) => {
    const img = document.createElement('img')
    img.src = photo.src
    img.alt = ''
    img.className = 'slide'
    img.loading = i === 0 ? 'eager' : 'lazy'
    if (i === 0) img.classList.add('is-active')
    stage.appendChild(img)

    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'slideshow-dot'
    dot.setAttribute('role', 'tab')
    dot.setAttribute('aria-label', `Photo ${i + 1}`)
    if (i === 0) dot.classList.add('is-active')
    dotsWrap.appendChild(dot)
  })

  if (photos.length < 2) return

  const slides = stage.querySelectorAll('.slide')
  const dots = dotsWrap.querySelectorAll('.slideshow-dot')
  let current = 0

  function goTo (index) {
    slides[current].classList.remove('is-active')
    dots[current].classList.remove('is-active')
    current = index
    slides[current].classList.add('is-active')
    dots[current].classList.add('is-active')
  }

  dots.forEach((dot, i) => dot.addEventListener('click', () => {
    goTo(i)
    resetTimer()
  }))

  let timer
  function resetTimer () {
    clearInterval(timer)
    if (reduceMotion) return
    timer = setInterval(() => goTo((current + 1) % slides.length), 5500)
  }
  resetTimer()
}

// ── Gallery grid ──────────────────────────────────────────────
function buildGallery (photos, openLightbox) {
  const grid = document.getElementById('gallery-grid')
  const empty = document.getElementById('gallery-empty')

  if (!photos.length) {
    empty.hidden = false
    return
  }

  photos.forEach((photo, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'gallery-item fade-in'
    btn.style.setProperty('--tilt', ((i % 5) - 2) * 0.8 + 'deg')
    btn.setAttribute('aria-label', `Agrandir la photo ${i + 1}`)

    const img = document.createElement('img')
    img.src = photo.src
    img.alt = photo.alt
    img.loading = 'lazy'

    btn.appendChild(img)
    btn.addEventListener('click', () => openLightbox(i))
    grid.appendChild(btn)
  })

  observeReveal(grid)
}

// ── Lightbox — returns an open(index) function for the gallery to call ──
function initLightbox (photos) {
  const lightbox = document.getElementById('lightbox')
  const imgEl = document.getElementById('lightbox-img')
  const countEl = document.getElementById('lightbox-count')
  const overlay = document.getElementById('lightbox-overlay')
  const closeBtn = document.getElementById('lightbox-close')
  const prevBtn = document.getElementById('lightbox-prev')
  const nextBtn = document.getElementById('lightbox-next')
  let index = 0

  function show (i) {
    index = (i + photos.length) % photos.length
    const photo = photos[index]
    imgEl.src = photo.src
    imgEl.alt = photo.alt
    countEl.textContent = `${index + 1} / ${photos.length}`
  }

  function open (i) {
    show(i)
    lightbox.hidden = false
    document.body.style.overflow = 'hidden'
  }

  function close () {
    lightbox.hidden = true
    document.body.style.overflow = ''
  }

  closeBtn.addEventListener('click', close)
  overlay.addEventListener('click', close)
  prevBtn.addEventListener('click', () => show(index - 1))
  nextBtn.addEventListener('click', () => show(index + 1))

  document.addEventListener('keydown', (e) => {
    if (lightbox.hidden) return
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowLeft') show(index - 1)
    if (e.key === 'ArrowRight') show(index + 1)
  })

  let touchStartX = 0
  lightbox.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX }, { passive: true })
  lightbox.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(dx) < 40) return
    show(index + (dx < 0 ? 1 : -1))
  }, { passive: true })

  return open
}

// ── Init ──────────────────────────────────────────────────────
async function init () {
  buildStars()
  observeReveal()

  const photos = await loadPhotos()
  buildSlideshow(photos)
  const openLightbox = initLightbox(photos)
  buildGallery(photos, openLightbox)
}

init()
