import { connect, countdown, countUp, reducedMotion, SHAPES } from '../socket.js'

// Host page: the big screen. Same key the admin page stores its login under
// (see src/admin-access.js) — being logged in there is what makes you the host.
const ADMIN_TOKEN_KEY = 'lm_admin_token'
const $ = (id) => document.getElementById(id)
const screens = [...document.querySelectorAll('.screen')]
const show = (id) => screens.forEach((s) => { s.hidden = s.id !== `screen-${id}` })

let token = ''
try { token = localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { /* ignore */ }

let sendFn = () => {}
let stopTimer = () => {}
let current = null // the question being shown
let lastReveal = null // the latest reveal message, which also carries the leaderboard
let boardTimers = []
let phase = 'lobby'

$('join-url').textContent = location.href.replace(/host\/?(\?.*)?$/, '').replace(/^https?:\/\//, '')

// One primary button whose job follows the game's phase. 'board' is a
// host-side step (answers -> leaderboard): no message goes to the server.
const PRIMARY = {
  lobby: ['Démarrer le quiz', 'start'],
  question: ['Afficher la réponse', 'reveal'],
  reveal: ['Voir le classement', 'board'],
  board: ['Question suivante', 'next'],
  final: null,
}
function setPhase (p) {
  phase = p
  const cfg = PRIMARY[p]
  $('controls').hidden = false
  $('btn-primary').hidden = !cfg
  if (cfg) $('btn-primary').textContent = p === 'board' && current && current.q + 1 >= current.total ? 'Voir le podium final' : cfg[0]
}
$('btn-primary').addEventListener('click', () => {
  const cfg = PRIMARY[phase]
  if (!cfg) return
  if (cfg[1] === 'board') return showBoard()
  sendFn({ t: 'cmd', c: cfg[1] })
})
$('btn-reset').addEventListener('click', () => { if (confirm('Remettre les scores à zéro et revenir au salon d\'attente ?')) sendFn({ t: 'cmd', c: 'reset' }) })

function optionBlocks (box, options, extra) {
  box.replaceChildren(...options.map((text, i) => {
    const d = document.createElement('div')
    d.className = `opt opt-${i}`
    d.innerHTML = '<span class="shape" aria-hidden="true"></span><span class="label"></span><span class="num"></span>'
    d.querySelector('.shape').textContent = SHAPES[i]
    d.querySelector('.label').textContent = text
    if (extra) extra(d, i)
    return d
  }))
}

function board (ol, rows) {
  ol.replaceChildren(...rows.map((r) => {
    const li = document.createElement('li')
    li.innerHTML = '<span class="n"></span><span class="s"></span>'
    li.querySelector('.n').textContent = r.n
    li.querySelector('.s').textContent = r.s
    return li
  }))
}

// ── Animated leaderboard ──────────────────────────────────────
// Rows start where they stood before the question, with their old score and
// rank; then they slide to their new place while the score counts up, the
// points just earned pop in, and an arrow shows how many places were won or lost.
const ROW_STEP = 3.7 // rem: row height + gap, must match .race li in style.css
const later = (fn, ms) => boardTimers.push(setTimeout(fn, ms))

function showBoard () {
  if (!lastReveal) return
  boardTimers.forEach(clearTimeout)
  boardTimers = []
  const m = lastReveal
  const ol = $('b-board')
  const rows = m.board.map((r) => ({ ...r, ps: r.s - r.d }))
  // Old order among the rows shown: by the score each had before this question.
  const before = new Map([...rows].sort((a, b) => b.ps - a.ps || a.n.localeCompare(b.n)).map((r, i) => [r.n, i]))
  const still = reducedMotion()
  ol.style.height = `${rows.length * ROW_STEP}rem`
  $('b-count').textContent = `Après la question ${m.q + 1} / ${m.total}`

  const items = rows.map((r, i) => {
    const li = document.createElement('li')
    li.innerHTML = '<span class="rk"></span><span class="n"></span><span class="gain"></span><span class="s"></span><span class="mv"></span>'
    li.querySelector('.n').textContent = r.n
    li.querySelector('.rk').textContent = still ? r.r : r.pr
    li.querySelector('.s').textContent = still ? r.s : r.ps
    li.style.transform = `translateY(${(still ? i : before.get(r.n)) * ROW_STEP}rem)`
    li.style.zIndex = rows.length - i
    return li
  })
  ol.replaceChildren(...items)
  show('board'); setPhase('board')

  const settle = () => rows.forEach((r, i) => {
    const li = items[i]
    li.style.transform = `translateY(${i * ROW_STEP}rem)`
    li.querySelector('.rk').textContent = r.r
    if (r.d > 0) {
      li.querySelector('.gain').textContent = `+${r.d}`
      li.classList.add('scored')
      countUp(li.querySelector('.s'), r.ps, r.s, 1100)
    }
    const moved = r.pr - r.r
    if (moved !== 0 && r.pr !== r.r) {
      li.querySelector('.mv').textContent = `${moved > 0 ? '▲' : '▼'} ${Math.abs(moved)}`
      li.classList.add(moved > 0 ? 'up' : 'down')
    }
    if (r.r === 1) li.classList.add('leader')
  })

  if (still) return settle()
  // Two beats: first the points land, then the rows slide into their new order.
  later(() => rows.forEach((r, i) => {
    if (r.d > 0) { items[i].querySelector('.gain').textContent = `+${r.d}`; items[i].classList.add('scored') }
  }), 500)
  later(settle, 1400)
}

function onMessage (m, send) {
  sendFn = send
  switch (m.t) {
    case 'error':
      $('auth-text').textContent = 'Session expirée : reconnectez-vous à l\'administration, puis rechargez cette page.'
      show('auth')
      break
    case 'lobby':
      stopTimer(); current = null
      show('lobby'); setPhase('lobby')
      break
    case 'tally':
      $('lobby-count').textContent = m.online
      $('answered').textContent = m.answered
      $('answered-of').textContent = m.online
      break
    case 'question':
      stopTimer(); current = m
      $('q-count').textContent = `Question ${m.q + 1} / ${m.total}`
      $('q-text').textContent = m.text
      optionBlocks($('q-options'), m.options)
      stopTimer = countdown(m.remaining, m.seconds * 1000, (s, frac) => {
        $('timer-bar').style.transform = `scaleX(${frac})`
        $('q-time').textContent = s
      })
      show('question'); setPhase('question')
      break
    case 'reveal': {
      stopTimer()
      lastReveal = m
      $('r-count').textContent = `Question ${m.q + 1} / ${m.total}`
      $('r-text').textContent = m.text
      const max = Math.max(1, ...m.counts)
      optionBlocks($('r-options'), m.options, (d, i) => {
        d.classList.toggle('is-correct', i === m.correct)
        d.classList.toggle('is-wrong', i !== m.correct)
        d.querySelector('.num').textContent = m.counts[i]
        d.style.setProperty('--fill', `${Math.round((m.counts[i] / max) * 100)}%`)
      })
      current = { q: m.q, total: m.total }
      show('reveal'); setPhase('reveal')
      break
    }
    case 'final':
      stopTimer()
      board($('final-top'), m.top)
      show('final'); setPhase('final')
      break
  }
}

if (!token) {
  show('auth')
} else {
  connect({
    onStatus: (online) => { $('offline').hidden = online },
    onOpen: (send) => { sendFn = send; send({ t: 'host', token }) },
    onMessage,
  })
}
