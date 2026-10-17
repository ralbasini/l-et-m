import { getSession, clearSession } from './session.js'

// The hamburger at the top right of the menu: the guest's name and avatar, a way to
// change the avatar, and a logout. The button shows for a guest (html.is-guest) and
// for a logged-in admin (html.is-admin), so every page with the menu has it; both
// classes are set before paint.
const burger = document.querySelector('.nav-burger')
const panel = document.getElementById('nav-account')

if (burger && panel) {
  const close = () => { panel.hidden = true; burger.setAttribute('aria-expanded', 'false') }

  async function render () {
    const { token, name, avatar } = getSession()
    const isAdmin = document.documentElement.classList.contains('is-admin')
    panel.replaceChildren()
    const who = document.createElement('div')
    who.className = 'nav-account-who'
    if (avatar) {
      const { avatarEl } = await import('./quiz/avatar.js')
      who.append(avatarEl(avatar))
    }
    const label = document.createElement('strong')
    label.textContent = name || 'Invité'
    who.append(label)

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.textContent = 'Modifier mon avatar'
    edit.addEventListener('click', async () => {
      close()
      try {
        const { requireGuest } = await import('./gate.js')
        await requireGuest({ edit: true })
        window.top.location.reload() // every panel picks up the new avatar
      } catch { /* cancelled */ }
    })

    // Discreet exit door in the corner of the panel.
    const out = document.createElement('button')
    out.type = 'button'
    out.className = 'nav-exit'
    out.title = 'Se déconnecter'
    out.setAttribute('aria-label', 'Se déconnecter')
    out.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/></svg>'
    // One exit for everything: forgets the guest account and, for an admin, logs out too
    // (the footer's logout does that and goes back to the home page).
    out.addEventListener('click', () => {
      clearSession()
      const adminOut = isAdmin && document.querySelector('.brand-footer-logout')
      if (adminOut) adminOut.click()
      else window.top.location.replace(import.meta.env.BASE_URL)
    })
    if (!token) label.textContent = isAdmin ? 'Administrateur' : 'Invité'
    who.append(out)
    panel.append(who, edit)
  }

  burger.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!panel.hidden) return close()
    await render()
    panel.hidden = false
    burger.setAttribute('aria-expanded', 'true')
  })
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) close() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
}
