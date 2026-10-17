import './avatar.css'
import './gate.css'
import { mountBuilder } from './avatar-builder.js'
import { getSession, fetchMe, register, updateAvatar } from './session.js'

// The login screen: a name and an avatar, shared by the photo page and the quiz.
// requireGuest() resolves with the session once the visitor has an account with an
// avatar, showing the screen only when needed:
//   - no account yet: name + avatar,
//   - an older account without an avatar: just the avatar,
//   - { edit: true }: change the avatar of the current account (can be cancelled).
let pending = null

export function requireGuest ({ edit = false } = {}) {
  if (pending) return pending
  pending = (async () => {
    const me = await fetchMe()
    if (me && me.avatar && !edit) return me
    return showGate({ me, edit })
  })().finally(() => { pending = null })
  return pending
}

function showGate ({ me, edit }) {
  return new Promise((resolve, reject) => {
    const hasAccount = Boolean(me)
    const gate = document.createElement('div')
    gate.id = 'gate'
    gate.innerHTML = `
      <div class="gate-inner">
        <p class="brand">L<span>&amp;</span>M</p>
        <h1>${edit ? 'Votre personnage' : hasAccount ? 'Bonjour !' : 'Bienvenue !'}</h1>
        <p class="sub">${edit ? 'Changez votre look.' : hasAccount ? 'Créez votre personnage pour continuer.' : "Merci de renseigner ton nom, et choisir ton avatar !"}</p>
        <form>
          <div data-ref="builder"></div>
          <div data-ref="nameField"${hasAccount ? ' hidden' : ''}>
            <label for="gate-name">Votre prénom</label>
            <input id="gate-name" type="text" maxlength="20" autocomplete="given-name" placeholder="ex. Camille" ${hasAccount ? '' : 'required'}>
          </div>
          <p class="error" data-ref="error" hidden></p>
          <button type="submit" data-ref="submit">${edit || hasAccount ? 'Enregistrer' : 'Entrer'}</button>
          ${edit ? '<button type="button" class="ghost" data-ref="cancel">Annuler</button>' : ''}
        </form>
      </div>`
    if (hasAccount && !edit) gate.querySelector('h1').textContent = `Bonjour ${me.name} !`
    const ref = (n) => gate.querySelector(`[data-ref="${n}"]`)
    // First login: just a random avatar, the settings open on request. Editing: settings open.
    const builder = mountBuilder(ref('builder'), me && me.avatar ? me.avatar : null, undefined, { collapsed: !edit && !(me && me.avatar) })
    document.body.append(gate)
    document.documentElement.classList.add('needs-login')

    const close = () => {
      gate.remove()
      document.documentElement.classList.remove('needs-login')
    }
    const cancel = ref('cancel')
    if (cancel) cancel.addEventListener('click', () => { close(); reject(new Error('cancelled')) })

    gate.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const error = ref('error')
      const btn = ref('submit')
      error.hidden = true
      btn.disabled = true
      try {
        if (hasAccount) await updateAvatar(builder.get())
        else await register(gate.querySelector('#gate-name').value, builder.get())
        close()
        resolve(getSession())
      } catch (err) {
        error.textContent = err.message
        error.hidden = false
        btn.disabled = false
      }
    })
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
    gate.querySelector('[data-ref="cancel"]').addEventListener('click', () => { gate.remove(); reject(new Error('cancelled')) })
    gate.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); gate.remove(); resolve(builder.get()) })
  })
}
