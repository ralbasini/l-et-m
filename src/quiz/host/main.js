import { connect, countdown, SHAPES } from '../socket.js'

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
let phase = 'lobby'
let players = 0

$('join-url').textContent = location.href.replace(/host\/?(\?.*)?$/, '').replace(/^https?:\/\//, '')

// One primary button whose job follows the game's phase.
const PRIMARY = {
  lobby: ['Démarrer le quiz', 'start'],
  question: ['Afficher la réponse', 'reveal'],
  reveal: ['Question suivante', 'next'],
  final: null,
}
function setPhase (p) {
  phase = p
  const cfg = PRIMARY[p]
  $('controls').hidden = false
  $('btn-primary').hidden = !cfg
  if (cfg) $('btn-primary').textContent = p === 'reveal' && current && current.q + 1 >= current.total ? 'Voir le classement final' : cfg[0]
}
$('btn-primary').addEventListener('click', () => PRIMARY[phase] && sendFn({ t: 'cmd', c: PRIMARY[phase][1] }))
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
      players = m.players
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
      $('r-count').textContent = `Question ${m.q + 1} / ${m.total}`
      $('r-text').textContent = m.text
      const max = Math.max(1, ...m.counts)
      optionBlocks($('r-options'), m.options, (d, i) => {
        d.classList.toggle('is-correct', i === m.correct)
        d.classList.toggle('is-wrong', i !== m.correct)
        d.querySelector('.num').textContent = m.counts[i]
        d.style.setProperty('--fill', `${Math.round((m.counts[i] / max) * 100)}%`)
      })
      board($('r-top'), m.top)
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
