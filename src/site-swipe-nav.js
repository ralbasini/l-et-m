import { isShown } from './admin-access.js'

// The Admin link isn't one of the swipeable pages, so arrow keys skip it —
// as they do any entry admin-access.js currently hides.
const nav = document.querySelector('.site-nav')
const links = nav ? [...nav.querySelectorAll('a[data-page]:not([data-page="admin"])')] : []
const embedded = window.parent !== window

// The site's base path ('/l-et-m/'), the same for every page.
const siteRoot = import.meta.env.BASE_URL

function getSection (href) {
  const target = new URL(href, location.href)

  if (target.origin !== location.origin) return null
  // Menu links point at the home page's panels: /l-et-m/#galerie etc.
  if (target.pathname === siteRoot) {
    const panel = target.hash.slice(1)
    return ['galerie', 'photos'].includes(panel) ? panel : 'mariage'
  }
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
    // A link into a section of a page (galerie/#galerie) also asks the home
    // page to scroll that panel to it. Not for /#galerie-style menu links,
    // where the hash is the panel name itself.
    const target = new URL(href, location.href)
    const anchor = target.pathname !== siteRoot ? target.hash.slice(1) : ''
    window.parent.postMessage({ type: 'site-nav', page, anchor }, location.origin)
    return
  }

  const target = new URL(href, location.href)
  if (target.origin === location.origin && target.pathname.startsWith(siteRoot)) {
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
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (document.querySelector('#lightbox:not([hidden])')) return

    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, select, button, [contenteditable="true"]')) return

    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!direction) return

    const shown = links.filter(isShown)
    const currentIndex = shown.findIndex((link) => link.classList.contains('is-current'))
    if (currentIndex < 0) return
    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= shown.length) return

    event.preventDefault()
    navigate(shown[nextIndex].href)
  })
}