import './avatar.css'
import './gate.css'
import { mountBuilder } from './avatar-builder.js'
import { getSession, fetchMe, register, nameExists, confirmLogin, updateAvatar } from './session.js'

// The login screen: a name and an avatar, shared by the photo page and the quiz.
// requireGuest() resolves with the session once the visitor has an account with an
// avatar, showing the screen only when needed:
//   - no account yet: name + avatar,
//   - an older account without an avatar: just the avatar,
//   - { edit: true }: change the avatar of the current account (can be cancelled).
let pending = null

// While a login screen is up, the site menu is hidden. The screen can live inside a panel
// (iframe) of the home page, so the class goes on the top page as well (same origin).
function gateOpen (on) {
  for (const win of new Set([window, window.top])) {
    try { win.document.documentElement.classList.toggle('gate-open', on) } catch { /* cross-origin */ }
  }
}

// After a login the guest lands on the Photos page, unless they came for a specific
// panel (#galerie…). Reloads the top window so every panel starts with the account.
export function goAfterLogin () {
  const top = window.top
  if (!top.location.hash || top.location.hash === '#mariage') top.location.hash = 'photos'
  top.location.reload()
}

export function requireGuest ({ edit = false, login = false, reload = false } = {}) {
  if (pending) return pending
  pending = (async () => {
    // login: the footer's "login" link always shows the form (name, avatar and, for an
    // administrator account, the password), even when another account is already active.
    if (login) return showGate({ me: null, edit: false, cancellable: true })
    const me = await fetchMe()
    if (me && me.avatar && !edit) return me
    return showGate({ me, edit, reload })
  })().finally(() => { pending = null })
  return pending
}

function showGate ({ me, edit, cancellable = false, reload = false }) {
  return new Promise((resolve, reject) => {
    let hasAccount = Boolean(me)
    // No account yet: two steps, first the name, then the avatar. With an account
    // (editing, or an old account without an avatar) it goes straight to the avatar.
    const gate = document.createElement('div')
    gate.id = 'gate'
    gate.innerHTML = `
      <div class="gate-inner">
        <p class="brand">L<span>&amp;</span>M</p>
        <h1 data-ref="title"></h1>
        <p class="sub" data-ref="sub"></p>
        <form>
          <div data-ref="step1"${hasAccount ? ' hidden' : ''}>
            <label for="gate-name">Votre prénom</label>
            <input id="gate-name" type="text" maxlength="20" autocomplete="given-name" placeholder="Merci de renseigner ton prénom"${hasAccount ? '' : ' required'}>
          </div>
          <div data-ref="step2"${hasAccount ? '' : ' hidden'}>
            <div data-ref="builder"></div>
          </div>
          <div data-ref="step3" hidden>
            <p class="confirm-text" data-ref="confirmText"></p>
            <div data-ref="pwField" hidden>
              <label for="gate-pw">Mot de passe administrateur</label>
              <input id="gate-pw" type="password" autocomplete="current-password">
            </div>
          </div>
          <p class="error" data-ref="error" hidden></p>
          <button type="submit" data-ref="submit"></button>
          <button type="button" class="ghost" data-ref="notme" hidden>Non, choisir un autre prénom</button>
        </form>
      </div>`
    const ref = (n) => gate.querySelector(`[data-ref="${n}"]`)
    // First login: just a random avatar, the settings open on request. Editing: settings open.
    const builder = mountBuilder(ref('builder'), me && me.avatar ? me.avatar : null, undefined, { collapsed: !edit && !(me && me.avatar) })
    document.body.append(gate)
    keepInputVisible(gate)
    document.documentElement.classList.add('needs-login')
    gateOpen(true)

    let step = hasAccount ? 2 : 1
    function render () {
      ref('step1').hidden = step !== 1
      ref('step2').hidden = step !== 2
      ref('step3').hidden = step !== 3
      ref('notme').hidden = step !== 3
      ref('error').hidden = true
      if (step === 1) {
        ref('title').textContent = 'Bienvenue cher invité !'
        ref('sub').textContent = "A qui ai-je l'honneur ?"
        ref('submit').textContent = 'Continuer'
        gate.querySelector('#gate-name').focus({ preventScroll: true })
      } else if (step === 3) {
        const typed = gate.querySelector('#gate-name').value.trim()
        ref('title').textContent = 'Déjà connu !'
        ref('sub').textContent = ''
        ref('confirmText').textContent = `Un invité s'appelle déjà « ${typed} ». Est-ce bien vous ?`
        ref('submit').textContent = "Oui, c'est moi"
      } else {
        ref('title').textContent = edit ? 'Votre avatar' : hasAccount ? `Bonjour ${me.name} !` : `Salut ${gate.querySelector('#gate-name').value.trim()} !`
        ref('sub').textContent = edit ? 'Changez votre look.' : 'Choisis ton avatar !'
        ref('submit').textContent = edit || hasAccount ? 'Enregistrer' : 'Entrer'
      }
      // Each step has a different height, and the keyboard may be opening or closing:
      // keep the main button on screen (the focused field is handled by keepInputVisible).
      setTimeout(() => { if (!document.activeElement.matches?.('input')) ref('submit').scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 350)
    }
    render()

    const close = () => {
      gate.remove()
      document.documentElement.classList.remove('needs-login')
      gateOpen(false)
    }
    // No cancel button; when leaving is allowed (editing, or the footer's login), Esc closes it.
    if (edit || cancellable) {
      const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(); reject(new Error('cancelled')) } }
      document.addEventListener('keydown', onKey)
    }

    gate.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const error = ref('error')
      const btn = ref('submit')
      error.hidden = true
      btn.disabled = true
      try {
        if (step === 1) {
          const typed = gate.querySelector('#gate-name').value.trim()
          if (!typed) return
          // A first name that already exists: ask "is it you?" instead of the avatar.
          step = (await nameExists(typed)) ? 3 : 2
          render()
          return
        }
        if (step === 3) {
          const s = await confirmLogin(gate.querySelector('#gate-name').value, gate.querySelector('#gate-pw').value)
          if (!s.avatar) { // an old account without an avatar: pick one now
            me = { name: s.name }; hasAccount = true; step = 2; render()
            return
          }
        } else if (hasAccount) await updateAvatar(builder.get())
        else await register(gate.querySelector('#gate-name').value, builder.get())
        if (reload) {
          // Public-site login: keep the screen up (a spinner) while the page loads again with
          // the account in place, instead of uncovering a half-ready Mariage page for a moment.
          gate.innerHTML = '<div class="gate-loading"><i></i></div>'
          resolve(getSession())
          goAfterLogin()
          return
        }
        close()
        resolve(getSession())
      } catch (err) {
        if (err.code === 'password_required') { ref('pwField').hidden = false; gate.querySelector('#gate-pw').focus() }
        error.textContent = err.message
        error.hidden = false
      } finally {
        btn.disabled = false
      }
    })
    ref('notme').addEventListener('click', () => { step = 1; render(); gate.querySelector('#gate-name').select() })
  })
}

// Avatar picker in the same overlay, for the admin's user list: resolves with the
// chosen [animal, colour, accessory] (the caller saves it), rejects on cancel.
export function pickAvatar (initial, title = 'Personnage') {
  return new Promise((resolve, reject) => {
    const gate = document.createElement('div')
    gate.id = 'gate'
    gate.innerHTML = `
      <div class="gate-inner">
        <h1></h1>
        <form>
          <div data-ref="builder"></div>
          <button type="submit">Enregistrer</button>
          <button type="button" class="ghost" data-ref="cancel">Annuler</button>
        </form>
      </div>`
    gate.querySelector('h1').textContent = title
    const builder = mountBuilder(gate.querySelector('[data-ref="builder"]'), initial)
    document.body.append(gate)
    gateOpen(true)
    gate.querySelector('[data-ref="cancel"]').addEventListener('click', () => { gate.remove(); gateOpen(false); reject(new Error('cancelled')) })
    gate.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); gate.remove(); gateOpen(false); resolve(builder.get()) })
  })
}

// On a phone the on-screen keyboard covers the lower part of the screen. Chrome on Android
// (Samsung included) leaves the page the same size and only shrinks what is *visible*
// (the visual viewport), so the login screen is fitted to that visible area while the
// keyboard is up, with extra scroll room below the card, and the field being typed in is
// brought to the middle of it. Samsung's keyboard animates slowly, hence the second pass.
function keepInputVisible (gate) {
  const vv = window.visualViewport
  const reveal = (el) => [200, 600].forEach((ms) => setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), ms))
  let wasKeyboard = false
  const fit = () => {
    if (!gate.isConnected) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); return }
    const keyboard = window.innerHeight - vv.height > 120
    // Only touch the styles (and re-center the field) when something changed: every change
    // can fire another viewport event, which made the screen jitter in a loop.
    const top = `${vv.offsetTop}px`
    const height = `${vv.height}px`
    if (gate.style.top !== top) gate.style.top = top
    if (gate.style.height !== height) gate.style.height = height
    gate.style.bottom = 'auto'
    gate.style.paddingBottom = keyboard ? '40vh' : ''
    const el = document.activeElement
    if (keyboard && !wasKeyboard && gate.contains(el) && el.matches('input')) reveal(el)
    wasKeyboard = keyboard
  }
  gate.addEventListener('focusin', (e) => { if (e.target.matches('input')) reveal(e.target) })
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit) }
}
