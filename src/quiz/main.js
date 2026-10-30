import { connect, countdown, countUp, SHAPES } from './socket.js'
import { roam } from './roam.js'
import { avatarEl } from './avatar.js'
import { requireGuest } from '../gate.js'
import { clearSession } from '../session.js'
import { API_BASE_URL } from '../photos.js'

// Player page. The player is the guest account (name + avatar, created on the login
// screen in src/gate.js): the phone sends its login token to join, then only the
// answer it tapped. Scoring and timing are the server's.
const $ = (id) => document.getElementById(id)
const screens = [...document.querySelectorAll('.screen')]
const show = (id) => screens.forEach((s) => { s.hidden = s.id !== `screen-${id}` })
const ERRORS = {
  quiz_disabled: "Le quiz n'est pas encore ouvert. Revenez dans un moment !",
  full: 'La partie est complète.',
  bad_request: 'Erreur, rechargez la page.',
}

let name = ''
let av = null
let token = ''
let sendFn = () => {}
let stopRoam = () => {}
// Puts the player's avatar on a stage, wandering, hopping and flipping.
function onStage (id, mood) {
  stopRoam()
  const el = avatarEl(av, 'xl')
  $(id).replaceChildren(el)
  stopRoam = roam($(id), el, mood)
}
let stopTimer = () => {}
let current = null

// Change the avatar on the account (same screen as the first login), then tell the room.
$('edit-avatar').addEventListener('click', async () => {
  try {
    const s = await requireGuest({ edit: true })
    av = s.avatar
    sendFn({ t: 'refresh' })
    onStage('wait-avatar', 'happy')
  } catch { /* cancelled */ }
})

function showQuestion (m) {
  current = m
  stopTimer()
  $('q-count').textContent = `Question ${m.q + 1} / ${m.total}`
  $('q-text').textContent = m.text
  const qImg = $('q-image'); qImg.hidden = !m.image; if (m.image) qImg.src = m.image
  const box = $('q-options')
  box.replaceChildren(...m.options.map((text, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `opt opt-${i}`
    b.innerHTML = `<span class="shape" aria-hidden="true">${SHAPES[i]}</span><span class="label"></span>`
    b.querySelector('.label').textContent = text
    if (m.images && m.images[i]) { const img = Object.assign(document.createElement('img'), { src: m.images[i], alt: text, draggable: false }); b.prepend(img) }
    b.addEventListener('click', () => answer(i))
    return b
  }))
  startTimer(m)
  show('question')
}

function startTimer (m) {
  stopTimer()
  stopTimer = countdown(m.remaining, m.seconds * 1000, (s, frac) => {
    $('timer-bar').style.transform = `scaleX(${frac})`
    $('q-time').textContent = `${s} s`
  })
}

function answer (choice) {
  if (!current) return
  // Optimistic: the server's `ack` confirms it, and a reconnect re-sends nothing
  // (the server keeps the first answer), so tapping twice is harmless.
  sendFn({ t: 'answer', q: current.q, c: choice })
  document.querySelectorAll('.opt').forEach((b) => { b.disabled = true })
}

// The site menu is part of this page but only appears once the quiz is over.
const setEnded = (on) => document.documentElement.classList.toggle('quiz-ended', on)

function onMessage (m) {
  setEnded(m.t === 'final')
  if (['question', 'final', 'error'].includes(m.t)) stopRoam() // not on 'pong' (every 30 s) or 'profile'
  switch (m.t) {
    case 'joined':
      name = m.name
      break
    case 'error':
      if (m.code === 'login_required') { clearSession(); location.reload(); break } // account gone: log in again
      $('closed-text').textContent = ERRORS[m.code] || 'Erreur.'
      show('closed')
      break
    case 'profile':
      name = m.name; av = m.av
      $('wait-title').textContent = `On y est presque,
${name} !`
      break
    case 'lobby':
      stopTimer(); current = null
      $('wait-title').textContent = `On y est presque,
${name} !`
      show('wait')
      onStage('wait-avatar', 'happy')
      break
    case 'question':
      showQuestion(m)
      break
    case 'time': // the host changed the answer time
      if (current && m.q === current.q) startTimer(m)
      break
    case 'ack':
      if (current && m.q === current.q) {
        stopTimer()
        $('sent-choice').textContent = `${SHAPES[m.c]} ${current.options[m.c]}`
        show('sent')
        onStage('sent-avatar', 'happy')
      }
      break
    case 'result': {
      stopTimer()
      const opts = current ? current.options : []
      const images = current ? current.images : null
      const right = m.choice === m.correct
      // All the answers again: the right one lit up, the player's pick tagged.
      $('result-answer').replaceChildren(...opts.map((text, i) => {
        const d = document.createElement('div')
        d.className = `opt opt-${i}${i === m.correct ? ' is-correct' : ' is-wrong'}${i === m.choice ? ' is-mine' : ''}`
        d.innerHTML = '<span class="shape" aria-hidden="true"></span><span class="label"></span><span class="tag"></span>'
        d.querySelector('.shape').textContent = SHAPES[i]
        d.querySelector('.label').textContent = text
        d.querySelector('.tag').textContent = i === m.correct ? '✓' : i === m.choice ? '✗' : ''
        if (images && images[i]) d.prepend(Object.assign(document.createElement('img'), { src: images[i], alt: text, draggable: false }))
        return d
      }))
      current = null
      const rImg = $('result-image'); rImg.hidden = !m.image; if (m.image) rImg.src = m.image
      $('result-title').textContent = m.choice === null ? 'Trop tard !' : right ? 'Bonne réponse !' : 'Raté…'
      document.body.dataset.result = m.choice === null ? 'late' : right ? 'right' : 'wrong'
      $('result-delta').textContent = right ? `+${m.delta} points` : '+0 point'
      // Score counts up from what it was before this question; the rank change slides in.
      // After the last question the rank stays secret until the final screen.
      const lastQ = m.q + 1 >= m.total
      const rankText = `${m.rank}${m.rank === 1 ? 'er' : 'e'} sur ${m.of} — `
      const move = $('result-move')
      const around = $('result-around')
      around.hidden = lastQ || !m.around
      if (!around.hidden) {
        around.replaceChildren(...m.around.map((row) => {
          const li = document.createElement('li')
          if (row.me) li.className = 'me'
          li.innerHTML = '<span class="rk"></span><span class="who"><span class="n"></span></span><span class="s"></span>'
          li.querySelector('.rk').textContent = row.r
          li.querySelector('.who').prepend(avatarEl(row.v))
          li.querySelector('.n').textContent = row.n
          li.querySelector('.s').textContent = row.s
          return li
        }))
      }
      if (lastQ) {
        $('result-rank').textContent = 'Le classement final arrive…'
        move.hidden = true
      } else {
        countUp($('result-rank'), m.score - m.delta, m.score, 900, (n) => `${rankText}${n} points`)
        const moved = m.prev - m.rank
        move.hidden = moved === 0
        move.className = `move ${moved > 0 ? 'up' : 'down'}`
        move.textContent = moved > 0 ? `▲ +${moved} place${moved > 1 ? 's' : ''}` : `▼ ${moved} place${moved < -1 ? 's' : ''}`
      }
      show('result')
      onStage('result-avatar', right ? 'happy' : 'sad')
      break
    }
    case 'final':
      stopTimer(); current = null
      delete document.body.dataset.result
      $('final-rank').textContent = `${m.rank}${m.rank === 1 ? 'er' : 'e'} sur ${m.of}`
      $('final-score').textContent = `${m.score} points`
      // Everyone, in order; the list scrolls and opens on this player's own row.
      const rows = m.all || m.top
      const list = $('final-all')
      list.replaceChildren(...rows.map((r) => {
        const li = document.createElement('li')
        if (r.n === name) li.className = 'me'
        li.innerHTML = '<span class="who"><span class="n"></span></span><span class="s"></span>'
        li.querySelector('.who').prepend(avatarEl(r.v))
        li.querySelector('.n').textContent = r.n
        li.querySelector('.s').textContent = r.s
        return li
      }))
      show('final')
      onStage('final-avatar', 'happy')
      requestAnimationFrame(() => { const me = list.querySelector('li.me'); if (me) list.scrollTop = me.offsetTop - (list.clientHeight - me.offsetHeight) / 2 })
      break
  }
  if (m.t !== 'result' && m.t !== 'final') delete document.body.dataset.result
}

// Administrators get a way to the host (projector) page from here.
try { if (localStorage.getItem('lm_admin_token')) $('host-link-wrap').hidden = false } catch { /* ignore */ }

async function boot () {
  // Quiz closed: say so, without asking anyone to log in.
  try {
    const settings = await (await fetch(API_BASE_URL + 'settings', { cache: 'no-store' })).json()
    if (!settings.quizEnabled) { show('closed'); return }
  } catch { /* offline: let the login / join flow report it */ }
  try {
    const s = await requireGuest()
    token = s.token; name = s.name; av = s.avatar
  } catch { return }
  connect({
    onStatus: (online) => { $('offline').hidden = online },
    onOpen: (send) => { sendFn = send; send({ t: 'join', token }) },
    onMessage,
  })
}
boot()
