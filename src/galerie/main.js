import { loadPhotos, loadThumb } from '../photos.js'
import '../site-swipe-nav.js'
import { API_BASE_URL } from '../photos.js'
import { toast } from '../toast.js'

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
  if (!photos.length) return

  // Two cross-fading layers, not one <img> per photo: only the visible
  // photo and the next one are ever downloaded.
  const layers = [0, 1].map(() => {
    const img = document.createElement('img')
    img.alt = ''
    img.className = 'slide'
    stage.appendChild(img)
    return img
  })
  layers[0].src = layers[0].dataset.src = photos[0].src
  layers[0].classList.add('is-active')

  if (photos.length < 2 || reduceMotion) return

  let current = 0
  let active = 0
  let loading = false

  function goTo (index) {
    const incoming = layers[1 - active]
    const done = () => {
      incoming.onload = incoming.onerror = null
      loading = false
    }
    incoming.onload = () => {
      layers[active].classList.remove('is-active')
      incoming.classList.add('is-active')
      active = 1 - active
      current = index
      done()
      new Image().src = photos[(current + 1) % photos.length].src // warm the next one
    }
    incoming.onerror = done // skip a photo that fails; try the next tick
    loading = true
    if (incoming.dataset.src === photos[index].src && incoming.complete) {
      incoming.onload() // already showing this photo (only 2 photos): no load event would fire
      return
    }
    incoming.dataset.src = photos[index].src
    incoming.src = photos[index].src
  }

  setInterval(() => {
    if (!loading) goTo((current + 1) % photos.length)
  }, 5500)
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
    loadThumb(img, photo.path)
    img.alt = photo.alt
    img.loading = 'lazy'

    btn.appendChild(img)

    // Polaroid caption: who uploaded it, in the card's bottom margin.
    if (photo.by) {
      btn.classList.add('has-name')
      const name = document.createElement('span')
      name.className = 'gallery-item-name'
      name.textContent = photo.by
      btn.appendChild(name)
    }
    btn.addEventListener('click', () => openLightbox(i))
    grid.appendChild(btn)
  })

  observeReveal(grid)
}

// ── Tag filter ──────────────────────────────────────────────
// Folders are purely organizational (see cloudflare/); tags are independent
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
function initLightbox (initialPhotos, { onDelete } = {}) {
  const lightbox = document.getElementById('lightbox')
  const imgEl = document.getElementById('lightbox-img')
  const countEl = document.getElementById('lightbox-count')
  const overlay = document.getElementById('lightbox-overlay')
  const closeBtn = document.getElementById('lightbox-close')
  const prevBtn = document.getElementById('lightbox-prev')
  const nextBtn = document.getElementById('lightbox-next')
  let photos = initialPhotos
  let index = 0

  // ── Admin tools (tag / delete), only when logged in as admin ──
  const adminBar = document.getElementById('lightbox-admin')
  const tagsEl = document.getElementById('lightbox-tags')
  const deleteBtn = document.getElementById('lightbox-delete')
  let registry = null

  const adminToken = () => { try { return localStorage.getItem('lm_admin_token') || '' } catch { return '' } }

  async function adminFetch (path, json) {
    const res = await fetch(API_BASE_URL + 'admin/' + path, {
      method: json ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + adminToken(), ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    })
    if (res.status === 401) {
      try { localStorage.removeItem('lm_admin_token') } catch {}
      document.documentElement.classList.remove('is-admin')
      throw new Error('Session expirée, merci de vous reconnecter.')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Erreur.')
    return data
  }

  function renderAdmin () {
    const isAdmin = Boolean(adminToken())
    lightbox.classList.toggle('is-admin', isAdmin)
    adminBar.hidden = !isAdmin
    if (!isAdmin) return
    const photo = photos[index]
    tagsEl.innerHTML = ''
    if (registry === null) {
      // The tag list lives behind the admin API; a made-up folder keeps the
      // response small (only the tags matter here).
      registry = []
      adminFetch('state?path=_').then((data) => { registry = data.registry || []; renderAdmin() }).catch(() => { registry = null })
      return
    }
    registry.forEach((tag) => {
      const on = photo.tags.includes(tag)
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'lightbox-tag' + (on ? ' is-on' : '')
      chip.textContent = tag
      chip.addEventListener('click', async () => {
        const tags = on ? photo.tags.filter((t) => t !== tag) : [...photo.tags, tag]
        chip.disabled = true
        try {
          await adminFetch('tag', { updates: [{ path: photo.path, tags }] })
          photo.tags = tags
        } catch (err) {
          toast(err.message, false)
        }
        if (photos[index] === photo) renderAdmin()
      })
      tagsEl.appendChild(chip)
    })
  }

  deleteBtn.addEventListener('click', async () => {
    const photo = photos[index]
    if (!confirm('Supprimer cette photo ?')) return
    deleteBtn.disabled = true
    try {
      await adminFetch('delete', { files: [photo.path] })
      toast('Photo supprimée.', true)
      onDelete?.(photo)
      if (!photos.length) close()
      else show(Math.min(index, photos.length - 1))
    } catch (err) {
      toast(err.message, false)
    } finally {
      deleteBtn.disabled = false
    }
  })

  // Click the photo: show it at its real resolution (scrollable); click again to fit.
  function setZoom (on) {
    lightbox.classList.toggle('is-zoomed', on)
    if (on) {
      lightbox.scrollLeft = (lightbox.scrollWidth - lightbox.clientWidth) / 2
      lightbox.scrollTop = (lightbox.scrollHeight - lightbox.clientHeight) / 2
    }
  }
  imgEl.addEventListener('click', () => setZoom(!lightbox.classList.contains('is-zoomed')))

  function show (i) {
    setZoom(false)
    index = (i + photos.length) % photos.length
    const photo = photos[index]
    imgEl.src = photo.src
    imgEl.alt = photo.alt
    countEl.textContent = `${index + 1} / ${photos.length}`
    renderAdmin()
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
    if (Math.abs(dx) < 40 || lightbox.classList.contains('is-zoomed')) return
    show(index + (dx < 0 ? 1 : -1))
  }, { passive: true })

  return { open, setPhotos }
}

// ── Init ──────────────────────────────────────────────────────
async function init () {
  buildStars()
  observeReveal()

  let photos = await loadPhotos()
  buildSlideshow(photos)
  const lightbox = initLightbox(photos, {
    // Deleted from the lightbox (admin): drop it from the page too.
    onDelete (photo) {
      photos = photos.filter((p) => p !== photo)
      showFilters()
    },
  })

  function showFilters () {
    buildTagFilters(photos, (filtered) => {
      lightbox.setPhotos(filtered)
      buildGallery(filtered, lightbox.open)
    })
  }
  showFilters()
}

init()
