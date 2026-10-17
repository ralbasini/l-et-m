import { connect, countdown, countUp, SHAPES } from './socket.js'
import { ANIMALS, ACCESSORIES, COLORS, avatarEl, randomAvatar } from './avatar.js'

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
  avatar_taken: 'Ce personnage est déjà pris : changez la couleur ou un accessoire.',
  avatar_required: 'Créez votre personnage.',
  bad_request: 'Erreur, rechargez la page.',
}

let pid = store.get('lm_quiz_pid')
if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); store.set('lm_quiz_pid', pid) }
let name = store.get('lm_quiz_name') || ''
let sendFn = () => {}
let stopTimer = () => {}
let current = null

let av = null
try { av = JSON.parse(store.get('lm_quiz_av')) } catch { /* none yet */ }
if (!Array.isArray(av) || av.length !== 3) av = randomAvatar()

// Avatar builder: pick an animal, a fur colour and an accessory. Each chip draws
// the result of choosing it, so the options preview themselves.
function chip (label, pressed, onClick, child) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `chip${pressed ? ' on' : ''}`
  b.title = label
  b.setAttribute('aria-label', label)
  b.setAttribute('aria-pressed', String(pressed))
  b.append(child)
  b.addEventListener('click', onClick)
  return b
}
function renderBuilder () {
  $('av-preview').replaceChildren(avatarEl(av, 'xl'))
  $('av-animals').replaceChildren(...ANIMALS.map((n, i) => chip(n, av[0] === i, () => { av[0] = i; renderBuilder() }, avatarEl([i, av[1], 0]))))
  $('av-colors').replaceChildren(...COLORS.map((c, i) => {
    const sw = document.createElement('span')
    sw.className = 'swatch'
    sw.style.background = c.fur
    sw.style.borderColor = c.dark
    return chip(c.name, av[1] === i, () => { av[1] = i; renderBuilder() }, sw)
  }))
  $('av-acc').replaceChildren(...ACCESSORIES.map((n, i) => {
    let child
    if (i === 0) { child = document.createElement('span'); child.className = 'none'; child.textContent = '∅' } else child = avatarEl([av[0], av[1], i])
    return chip(n, av[2] === i, () => { av[2] = i; renderBuilder() }, child)
  }))
}
$('av-random').addEventListener('click', () => { av = randomAvatar(); renderBuilder() })
renderBuilder()

$('name').value = name
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault()
  name = $('name').value.trim()
  if (!name) return
  $('join-error').hidden = true
  sendFn({ t: 'join', pid, name, av })
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
      store.set('lm_quiz_av', JSON.stringify(av))
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
      $('wait-avatar').replaceChildren(avatarEl(av, 'xl'))
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
    if (name) send({ t: 'join', pid, name, av })
    else show('join')
  },
  onMessage,
})
