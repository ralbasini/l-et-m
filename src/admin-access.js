import { API_BASE_URL } from './photos.js'
import { logoutAll } from './session.js'

// Galerie / Photos menu entries (marked `data-admin-only`) are shown
// when either:
//   - this browser is logged in to the admin panel (html.is-admin), or
//   - the admin switched "menu public" on in the dashboard (html.menu-public),
//     a site-wide setting stored by the Worker (cloudflare/src/routes/settings.js).
// Otherwise visitors only see "Mariage"; the pages themselves stay reachable
// by direct link or QR code either way. Purely cosmetic — every admin API
// call checks its token server-side.
//
// The site-chrome plugin (vite.config.js) sets both classes in every page's
// <head> before first paint (menu-public from
// the last value cached here), and CSS hides
// `html:not(.is-admin):not(.menu-public) [data-admin-only]`, so nothing
// flashes in; this module then refreshes menu-public from the server.
export const ADMIN_TOKEN_KEY = 'lm_admin_token'
const MENU_PUBLIC_KEY = 'lm_menu_public'

export function setQuizOn (on) {
  document.documentElement.classList.toggle('quiz-on', on)
  try { localStorage.setItem('lm_quiz_enabled', on ? '1' : '0') } catch {}
}

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

// The footer's "logout" button (only shown when logged in — see src/site-chrome.css):
// the shared logout, src/session.js.

// Logging out in one tab logs out every other open tab of the site too.
window.addEventListener('storage', (e) => {
  if (window.parent === window && (e.key === ADMIN_TOKEN_KEY || e.key === 'lm_guest_token') && e.oldValue && !e.newValue) location.reload()
})

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return
  if (event.target.closest('.brand-footer-logout')) logoutAll()
  // The footer's "login" opens the login screen (name + avatar; an administrator
  // account is then asked for the admin password), not the admin page.
  if (event.target.closest('.brand-footer-login')) {
    event.preventDefault()
    import('./gate.js')
      .then((m) => m.requireGuest({ login: true }).then(() => m.goAfterLogin()))
      .catch(() => { /* cancelled */ })
  }
})

// Embedded panels (iframes of the one-pager) share localStorage with the
// top page, which does the fetch — no need for one request per panel.
if (window.parent === window) {
  // Safety: never keep the page hidden for long if the server does not answer.
  setTimeout(() => { if (!document.getElementById('gate')) document.documentElement.classList.remove('needs-login') }, 8000)
  fetch(API_BASE_URL + 'settings', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((settings) => {
      if (!settings) { document.documentElement.classList.remove('needs-login'); return }
      setMenuPublic(Boolean(settings.menuPublic))
      setQuizOn(Boolean(settings.quizEnabled))
      window.dispatchEvent(new Event('lm:settings'))
      // Public site: every visitor needs an account (name + avatar), except a logged-in admin.
      const isAdmin = document.documentElement.classList.contains('is-admin')
      if (settings.menuPublic && !isAdmin) import('./gate.js').then((m) => m.requireGuest({ reload: true })).catch(() => document.documentElement.classList.remove('needs-login'))
      else document.documentElement.classList.remove('needs-login')
    })
    .catch(() => { document.documentElement.classList.remove('needs-login') }) // never leave the page hidden
}
