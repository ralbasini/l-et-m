// Galerie / Photos / Admin menu entries are only shown to someone logged in
// to the admin panel (src/admin/) in this browser. Visitors only see
// "Mariage" — the pages themselves stay reachable by direct link or QR code,
// this just keeps them out of the menu. Purely cosmetic: the token is
// checked server-side by every admin API call, not here.
//
// Elements opt in with a `data-admin-only` attribute. Each page's <head>
// also sets `html.is-admin` before first paint and hides
// `html:not(.is-admin) [data-admin-only]` in CSS, so visitors never see the
// links flash in; removing them here (rather than only hiding them) keeps
// them out of site-swipe-nav.js's / onepager.js's arrow-key navigation too.
// Import this before either of those reads the nav.
export const ADMIN_TOKEN_KEY = 'lm_admin_token'

export function isAdmin () {
  try {
    return Boolean(localStorage.getItem(ADMIN_TOKEN_KEY))
  } catch {
    return false
  }
}

if (!isAdmin()) {
  document.querySelectorAll('[data-admin-only]').forEach((el) => el.remove())
}
