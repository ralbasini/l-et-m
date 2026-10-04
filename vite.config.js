import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))
const base = '/'

function redirectBarePhotosPath (request, response, next) {
  const pathname = new URL(request.url || '/', 'http://vite.local').pathname
  if (pathname !== `${base}photos`) return next()

  response.statusCode = 302
  response.setHeader('Location', `${base}#photos`)
  response.end()
}

// ── Site chrome: the top menu and the L&M footer ──────────────────────
// The single source of their markup. Every page has `<!-- site-nav -->`
// and `<!-- site-footer -->` placeholders, replaced here at build (and dev)
// time, plus src/site-chrome.css linked at the end of its <head> — so
// changing the menu or footer here or in that stylesheet changes every
// page at once.
//
// Menu links all point at the home page's swipe panels (/#galerie etc.,
// see src/onepager.js), including Admin. Galerie /
// Photos are `data-admin-only`: shown to logged-in admins, and to everyone
// once the dashboard switch makes the site public. Admin is
// `data-logged-in-only`: logged-in admins only, public or not. (See
// src/site-chrome.css + src/admin-access.js.) On its own page, the current
// entry always shows.
const NAV_ITEMS = [
  { page: 'mariage', label: 'Mariage', href: base },
  { page: 'galerie', label: 'Galerie', href: `${base}#galerie`, adminOnly: true },
  { page: 'photos', label: 'Photos', href: `${base}#photos`, adminOnly: true },
  { page: 'admin', label: 'Admin', href: `${base}#admin`, loggedInOnly: true },
]

// Which menu entry a page highlights, from its path under src/.
function currentPage (htmlPath) {
  const dir = htmlPath.replace(/^\/+/, '').replace(/\/?index\.html$/, '')
  return dir === '' ? 'mariage' : dir
}

function siteNav (current) {
  const links = NAV_ITEMS.map(({ page, label, href, adminOnly, loggedInOnly }) => {
    const attrs = [`href="${href}"`, `data-page="${page}"`]
    if (page === current) attrs.push('class="is-current"', 'aria-current="page"')
    else if (adminOnly) attrs.push('data-admin-only')
    else if (loggedInOnly) attrs.push('data-logged-in-only')
    return `<a ${attrs.join(' ')}>${label}</a>`
  })
  return `<nav class="site-nav" aria-label="Navigation">${links.join('')}</nav>`
}

const SITE_FOOTER = '<footer class="brand-footer" aria-label="Lobna et Martin">' +
  '<span class="brand-footer-logo">L<span>&amp;</span>M</span>' +
  // Only one of these two shows: login (to the admin page) when logged out,
  // logout when logged in (src/site-chrome.css; the logout click is handled
  // in src/admin-access.js).
  `<a href="${base}admin/" class="brand-footer-action brand-footer-login">login</a>` +
  '<button type="button" class="brand-footer-action brand-footer-logout">logout</button>' +
  '</footer>'

// Runs before first paint, so the admin-only entries never flash in or out:
// html.is-admin when logged in to the admin panel in this browser,
// html.menu-public from the last value src/admin-access.js cached.
const CHROME_HEAD = '<script>try {' +
  " if (localStorage.getItem('lm_admin_token')) document.documentElement.classList.add('is-admin');" +
  " if (localStorage.getItem('lm_menu_public') === '1') document.documentElement.classList.add('menu-public')" +
  ' } catch (e) {}' +
  // Loading screen: top-level pages only (the home panels are iframes).
  " try { if (window.top === window) document.documentElement.classList.add('is-loading') } catch (e) {}</script>" +
  // Inline so it paints before any stylesheet has loaded. While loading, the
  // page is blank: only the menu, a spinner and the footer remain.
  '<style>html.is-loading{background:#d0dad1}' +
  'html.is-loading body>*:not(.site-nav):not(.brand-footer):not(#page-loader):not(script):not(style):not(:has(.brand-footer)){display:none!important}' +
  'html.is-loading body>:has(.brand-footer)>*:not(.brand-footer){display:none!important}' +
  'html.is-loading body>:has(.brand-footer){flex:0 0 auto!important;height:auto!important}' +
  'html.is-loading body{background:#d0dad1!important}' +
  'html.is-loading #page-loader{display:flex}' +
  '#page-loader{display:none;flex:1 1 auto;align-items:center;justify-content:center;padding-top:var(--site-nav-offset,3.1rem)}' +
  '#page-loader i{width:2.5rem;height:2.5rem;border:3px solid rgba(53,109,101,.2);border-top-color:#356d65;border-radius:50%;animation:lm-spin .8s linear infinite}' +
  '@keyframes lm-spin{to{transform:rotate(360deg)}}</style>'

// First thing in <body>: the spinner, removed once everything (images, fonts,
// iframes) has loaded, or after 15 s whatever happens.
const PAGE_LOADER = '<div id="page-loader" aria-hidden="true"><i></i></div>' +
  '<script>(function () {' +
  " var done = function () { document.documentElement.classList.remove('is-loading') };" +
  " if (document.readyState === 'complete') done(); else window.addEventListener('load', done);" +
  ' setTimeout(done, 15000)' +
  '})()</script>'

// Linked at the end of <head> so it loads after each page's own CSS.
// admin-access.js refreshes the "menu public" setting from the server.
const CHROME_HEAD_END = '<link rel="preconnect" href="https://l-et-m-api.romain-albasini.workers.dev">' +
  '<link rel="stylesheet" href="/site-chrome.css">' +
  '<script type="module" src="/admin-access.js"></script>'

const siteChrome = {
  name: 'site-chrome',
  transformIndexHtml: {
    // 'pre' so Vite still processes the injected stylesheet/script
    // (bundling, base prefix) like any tag written in the page.
    order: 'pre',
    handler (html, ctx) {
      if (!html.includes('<!-- site-nav -->')) return html
      return html
        .replace(/<head>/i, (head) => `${head}\n${CHROME_HEAD}`)
        .replace('</head>', `${CHROME_HEAD_END}\n</head>`)
        .replace(/<body[^>]*>/i, (body) => `${body}\n${PAGE_LOADER}`)
        .replace('<!-- site-nav -->', siteNav(currentPage(ctx.path)))
        .replace('<!-- site-footer -->', SITE_FOOTER)
    },
  },
}

export default defineConfig({
  root: 'src',
  base,
  plugins: [siteChrome, {
    name: 'bare-photos-route-redirect',
    configureServer (server) {
      server.middlewares.use(redirectBarePhotosPath)
    },
    configurePreviewServer (server) {
      server.middlewares.use(redirectBarePhotosPath)
    },
  }],
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Root = the site-home "wedding info" page — the default page.
        main: r('src/index.html'),
        galerie: r('src/galerie/index.html'),
        diaporama: r('src/diaporama/index.html'),
        slideshow: r('src/slideshow/index.html'),
        admin: r('src/admin/index.html'),
        photos: r('src/photos/index.html'),
        // Redirect-only stubs, kept as thin forwards so an already-shared
        // URL/QR code doesn't just start 404ing after a page moved:
        // /guest -> /photos, /mariage -> / (root), /slideshow -> /diaporama.
        guest: r('src/guest/index.html'),
        mariage: r('src/mariage/index.html'),
      },
    },
  },
})
