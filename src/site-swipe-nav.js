// Routes links clicked inside a home-page panel to the shell (no keyboard or
// swipe navigation: pages are only reached from the menu).
const embedded = window.parent !== window

// The site's base path ('/'), the same for every page.
const siteRoot = import.meta.env.BASE_URL

function getSection (href) {
  const target = new URL(href, location.href)

  if (target.origin !== location.origin) return null
  // Menu links point at the home page's panels: /#galerie etc.
  if (target.pathname === siteRoot) {
    const panel = target.hash.slice(1)
    return ['galerie', 'photos', 'admin'].includes(panel) ? panel : 'mariage'
  }
  if (target.pathname === `${siteRoot}galerie/`) return 'galerie'
  if (target.pathname === `${siteRoot}photos/`) return 'photos'
  if (target.pathname === `${siteRoot}admin/`) return 'admin'
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
    // In-page anchor (#programme…): the page handles it, not the shell.
    if (target.pathname === location.pathname && target.hash && !['#galerie', '#photos', '#admin'].includes(target.hash)) return
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
