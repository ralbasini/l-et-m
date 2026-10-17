import { connect, countdown, countUp, SHAPES } from './socket.js'

// Player page. The phone only ever sends two things: who it is (a random id
// kept in localStorage, so a reload or lost connection rejoins as the same
// player) and which answer was tapped. Scoring and timing are the server's.
const $ = (id) => document.getElementById(id)
const screens = [...document.querySelectorAll('.screen')]
const show = (id) => screens.forEach((s) => { s.hidden = s.id !== `screen-${id}` })
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

const ERRORS = {
  name_taken: 'Ce prénom est déjà pris, ajoutez par exemple une initiale.',
  name_required: 'Entrez votre prénom.',
  full: 'La partie est complète.',
  bad_request: 'Erreur, rechargez la page.',
}

let pid = store.get('lm_quiz_pid')
if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); store.set('lm_quiz_pid', pid) }
let name = store.get('lm_quiz_name') || ''
let sendFn = () => {}
let stopTimer = () => {}
let current = null

$('name').value = name
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault()
  name = $('name').value.trim()
  if (!name) return
  $('join-error').hidden = true
  sendFn({ t: 'join', pid, name })
})

function showQuestion (m) {
  current = m
  stopTimer()
  $('q-count').textContent = `Question ${m.q + 1} / ${m.total}`
  $('q-text').textContent = m.text
  const box = $('q-options')
  box.replaceChildren(...m.options.map((text, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `opt opt-${i}`
    b.innerHTML = `<span class="shape" aria-hidden="true">${SHAPES[i]}</span><span class="label"></span>`
    b.querySelector('.label').textContent = text
    b.addEventListener('click', () => answer(i))
    return b
  }))
  stopTimer = countdown(m.remaining, m.seconds * 1000, (s, frac) => {
    $('timer-bar').style.transform = `scaleX(${frac})`
    $('q-time').textContent = `${s} s`
  })
  show('question')
}

function answer (choice) {
  if (!current) return
  // Optimistic: the server's `ack` confirms it, and a reconnect re-sends nothing
  // (the server keeps the first answer), so tapping twice is harmless.
  sendFn({ t: 'answer', q: current.q, c: choice })
  document.querySelectorAll('.opt').forEach((b) => { b.disabled = true })
}

function onMessage (m) {
  switch (m.t) {
    case 'joined':
      name = m.name
      store.set('lm_quiz_name', name)
      break
    case 'error':
      if (m.code === 'name_required' && !name) break
      $('join-error').textContent = ERRORS[m.code] || 'Erreur.'
      $('join-error').hidden = false
      show('join')
      break
    case 'lobby':
      stopTimer(); current = null
      $('wait-title').textContent = `C'est noté, ${name} !`
      show('wait')
      break
    case 'question':
      showQuestion(m)
      break
    case 'ack':
      if (current && m.q === current.q) {
        stopTimer()
        $('sent-choice').textContent = `${SHAPES[m.c]} ${current.options[m.c]}`
        show('sent')
      }
      break
    case 'result': {
      stopTimer()
      const opts = current ? current.options : []
      const right = m.choice === m.correct
      // All the answers again: the right one lit up, the player's pick tagged.
      $('result-answer').replaceChildren(...opts.map((text, i) => {
        const d = document.createElement('div')
        d.className = `opt opt-${i}${i === m.correct ? ' is-correct' : ' is-wrong'}${i === m.choice ? ' is-mine' : ''}`
        d.innerHTML = '<span class="shape" aria-hidden="true"></span><span class="label"></span><span class="tag"></span>'
        d.querySelector('.shape').textContent = SHAPES[i]
        d.querySelector('.label').textContent = text
        d.querySelector('.tag').textContent = i === m.correct ? '✓' : i === m.choice ? '✗' : ''
        return d
      }))
      current = null
      $('result-title').textContent = m.choice === null ? 'Trop tard !' : right ? 'Bonne réponse !' : 'Raté…'
      document.body.dataset.result = m.choice === null ? 'late' : right ? 'right' : 'wrong'
      $('result-delta').textContent = right ? `+${m.delta} points` : '+0 point'
      // Score counts up from what it was before this question; the rank change slides in.
      const rankText = `${m.rank}${m.rank === 1 ? 'er' : 'e'} sur ${m.of} — `
      countUp($('result-rank'), m.score - m.delta, m.score, 900, (n) => `${rankText}${n} points`)
      const moved = m.prev - m.rank
      const move = $('result-move')
      move.hidden = moved === 0
      move.className = `move ${moved > 0 ? 'up' : 'down'}`
      move.textContent = moved > 0 ? `▲ +${moved} place${moved > 1 ? 's' : ''}` : `▼ ${moved} place${moved < -1 ? 's' : ''}`
      show('result')
      break
    }
    case 'final':
      stopTimer(); current = null
      delete document.body.dataset.result
      $('final-rank').textContent = `${m.rank}${m.rank === 1 ? 'er' : 'e'} sur ${m.of}`
      $('final-score').textContent = `${m.score} points`
      $('final-top').replaceChildren(...m.top.map((r) => {
        const li = document.createElement('li')
        li.innerHTML = '<span class="n"></span><span class="s"></span>'
        li.querySelector('.n').textContent = r.n
        li.querySelector('.s').textContent = r.s
        return li
      }))
      show('final')
      break
  }
  if (m.t !== 'result' && m.t !== 'final') delete document.body.dataset.result
}

connect({
  onStatus: (online) => { $('offline').hidden = online },
  onOpen: (send) => {
    sendFn = send
    // A returning phone re-joins silently; a new one sees the name form.
    if (name) send({ t: 'join', pid, name })
    else show('join')
  },
  onMessage,
})
