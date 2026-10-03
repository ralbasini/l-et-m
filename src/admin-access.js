import { API_BASE_URL } from './photos.js'

// Galerie / Photos / Admin menu entries (marked `data-admin-only`) are shown
// when either:
//   - this browser is logged in to the admin panel (html.is-admin), or
//   - the admin switched "menu public" on in the dashboard (html.menu-public),
//     a site-wide setting stored by the Worker (cloudflare/src/routes/settings.js).
// Otherwise visitors only see "Mariage"; the pages themselves stay reachable
// by direct link or QR code either way. Purely cosmetic — every admin API
// call checks its token server-side.
//
// Each page's <head> sets both classes before first paint (menu-public from
// the last value cached here), and CSS hides
// `html:not(.is-admin):not(.menu-public) [data-admin-only]`, so nothing
// flashes in; this module then refreshes menu-public from the server.
export const ADMIN_TOKEN_KEY = 'lm_admin_token'
const MENU_PUBLIC_KEY = 'lm_menu_public'

export function setMenuPublic (on) {
  document.documentElement.classList.toggle('menu-public', on)
  try { localStorage.setItem(MENU_PUBLIC_KEY, on ? '1' : '0') } catch {}
}

// Whether a nav link is currently shown — used by site-swipe-nav.js and
// onepager.js so arrow keys only step through visible entries. Checked at
// use time, since the setting can arrive after those scripts start.
export function isShown (link) {
  return getComputedStyle(link).display !== 'none'
}

// Embedded panels (iframes of the one-pager) share localStorage with the
// top page, which does the fetch — no need for one request per panel.
if (window.parent === window) {
  fetch(API_BASE_URL + 'settings', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((settings) => { if (settings) setMenuPublic(Boolean(settings.menuPublic)) })
    .catch(() => {})
}
