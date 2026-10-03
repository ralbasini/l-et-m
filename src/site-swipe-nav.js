import './admin-access.js'

// The Admin link isn't one of the swipeable pages, so arrow keys skip it.
const nav = document.querySelector('.site-nav')
const links = nav ? [...nav.querySelectorAll('a:not([data-admin-link])')] : []
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
}