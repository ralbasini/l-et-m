const nav = document.querySelector('.site-nav')
const links = nav ? [...nav.querySelectorAll('a')] : []
const embedded = window.parent !== window

function getSection (href) {
  const target = new URL(href, location.href)
  const parentUrl = new URL(document.referrer || location.href)
  const siteRoot = new URL('.', parentUrl).pathname

  if (target.origin !== location.origin) return null
  if (target.pathname === siteRoot) return 'mariage'
  if (target.pathname === `${siteRoot}galerie/`) return 'galerie'
  if (target.pathname === `${siteRoot}photos/`) return 'photos'
  return null
}

function navigate (href) {
  if (!embedded) {
    window.location.assign(href)
    return
  }

  const page = getSection(href)
  if (page) {
    window.parent.postMessage({ type: 'site-nav', page }, location.origin)
    return
  }

  const target = new URL(href, location.href)
  if (target.origin === location.origin && target.pathname.startsWith(new URL(document.referrer || location.href).pathname.replace(/[^/]*$/, ''))) {
    window.top.location.assign(target.href)
  }
}

if (embedded) {
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element && event.target.closest('a[href]')
    if (!link || link.target && link.target !== '_self') return

    const target = new URL(link.href, location.href)
    const page = getSection(target.href)
    if (page) {
      event.preventDefault()
      navigate(target.href)
    } else if (target.origin === location.origin && !target.hash && target.pathname !== location.pathname) {
      event.preventDefault()
      navigate(target.href)
    }
  }, true)
}

if (links.length > 1) {
  let start = null
  let horizontalGesture = false

  function navigateByDirection (direction) {
    const currentIndex = links.findIndex((link) => link.classList.contains('is-current'))
    if (currentIndex < 0) return

    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= links.length) return
    navigate(links[nextIndex].href)
  }

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (document.querySelector('#lightbox:not([hidden])')) return

    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, select, button, [contenteditable="true"]')) return

    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!direction) return

    const currentIndex = links.findIndex((link) => link.classList.contains('is-current'))
    if (currentIndex + direction < 0 || currentIndex + direction >= links.length) return

    event.preventDefault()
    navigateByDirection(direction)
  })

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || document.querySelector('#lightbox:not([hidden])')) {
      start = null
      horizontalGesture = false
      return
    }

    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, select, label, [contenteditable="true"], #upload-progress:not([hidden])')) {
      start = null
      horizontalGesture = false
      return
    }

    const touch = event.touches[0]
    const edge = 8
    if (touch.clientX < edge || touch.clientX > window.innerWidth - edge) {
      start = null
      horizontalGesture = false
      return
    }

    start = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    horizontalGesture = false
  }, { passive: true })

  document.addEventListener('touchmove', (event) => {
    if (!start || event.touches.length !== 1) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      horizontalGesture = true
      if (event.cancelable) event.preventDefault()
    }
  }, { passive: false })

  document.addEventListener('touchend', (event) => {
    if (!start || event.changedTouches.length !== 1) {
      start = null
      horizontalGesture = false
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const duration = Date.now() - start.time
    start = null

    if (!horizontalGesture || Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25 || duration > 2000) {
      horizontalGesture = false
      return
    }

    if (event.cancelable) event.preventDefault()
    horizontalGesture = false
    const direction = deltaX < 0 ? 1 : -1
    navigateByDirection(direction)
  }, { passive: false })

  document.addEventListener('touchcancel', () => {
    start = null
    horizontalGesture = false
  }, { passive: true })
}