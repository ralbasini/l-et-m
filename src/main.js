import { loadPhotos } from './photos.js'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

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
// Rebuildable: called again with a new (filtered) list whenever the tag
// filter changes.
function buildGallery (photos, openLightbox) {
  const grid = document.getElementById('gallery-grid')
  const empty = document.getElementById('gallery-empty')

  grid.innerHTML = ''
  empty.hidden = photos.length > 0

  photos.forEach((photo, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'gallery-item fade-in'
    btn.style.setProperty('--tilt', ((i % 5) - 2) * 2.5 + 'deg')
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

// ── Tag filter ──────────────────────────────────────────────
// Folders are purely organizational (see infomaniak/); tags are independent
// metadata a photo can carry any number of. Selecting several tags shows
// photos matching ANY of them (union, not intersection).
function buildTagFilters (allPhotos, onChange) {
  const wrap = document.getElementById('gallery-filters')
  const tags = Array.from(new Set(allPhotos.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b))
  if (!tags.length) {
    wrap.hidden = true
    onChange(allPhotos)
    return
  }
  wrap.hidden = false

  const active = new Set()

  function render () {
    wrap.innerHTML = ''

    const allChip = document.createElement('button')
    allChip.type = 'button'
    allChip.className = 'filter-chip' + (active.size === 0 ? ' is-active' : '')
    allChip.textContent = 'Toutes'
    allChip.addEventListener('click', () => {
      active.clear()
      render()
    })
    wrap.appendChild(allChip)

    tags.forEach((tag) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'filter-chip' + (active.has(tag) ? ' is-active' : '')
      chip.textContent = tag
      chip.addEventListener('click', () => {
        if (active.has(tag)) active.delete(tag)
        else active.add(tag)
        render()
      })
      wrap.appendChild(chip)
    })

    const filtered = active.size === 0
      ? allPhotos
      : allPhotos.filter((p) => p.tags.some((t) => active.has(t)))
    onChange(filtered)
  }

  render()
}

// ── Lightbox — returns { open, setPhotos } for the gallery to call ──
function initLightbox (initialPhotos) {
  const lightbox = document.getElementById('lightbox')
  const imgEl = document.getElementById('lightbox-img')
  const countEl = document.getElementById('lightbox-count')
  const overlay = document.getElementById('lightbox-overlay')
  const closeBtn = document.getElementById('lightbox-close')
  const prevBtn = document.getElementById('lightbox-prev')
  const nextBtn = document.getElementById('lightbox-next')
  let photos = initialPhotos
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

  function setPhotos (next) {
    photos = next
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

  return { open, setPhotos }
}

// ── Init ──────────────────────────────────────────────────────
async function init () {
  buildStars()
  observeReveal()

  const photos = await loadPhotos()
  buildSlideshow(photos)
  const lightbox = initLightbox(photos)

  buildTagFilters(photos, (filtered) => {
    lightbox.setPhotos(filtered)
    buildGallery(filtered, lightbox.open)
  })
}

init()
