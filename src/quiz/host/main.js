import { connect, countdown, countUp, SHAPES } from '../socket.js'
import { avatarEl } from '../avatar.js'

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
  if (cfg) $('btn-primary').textContent = p === 'reveal' && current && current.q + 1 >= current.total ? 'Voir le podium final' : cfg[0]
}
$('btn-primary').addEventListener('click', () => {
  const cfg = PRIMARY[phase]
  if (!cfg) return
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
  const still = false // projector: always animated, even if the laptop has OS animations off
  ol.style.height = `${rows.length * ROW_STEP}rem`

  const items = rows.map((r, i) => {
    const li = document.createElement('li')
    li.innerHTML = '<span class="rk"></span><span class="n"></span><span class="gain"></span><span class="s"></span><span class="mv"></span>'
    li.querySelector('.n').textContent = r.n
    li.querySelector('.n').before(avatarEl(r.v))
    li.querySelector('.rk').textContent = still ? r.r : r.pr
    li.querySelector('.s').textContent = still ? r.s : r.ps
    li.style.transform = `translateY(${(still ? i : before.get(r.n)) * ROW_STEP}rem)`
    li.style.zIndex = rows.length - i
    return li
  })
  ol.replaceChildren(...items)

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

// ── Final podium ──────────────────────────────────────────────
// 2nd-1st-3rd blocks rise one after the other (3rd, 2nd, then the winner),
// then fireworks and confetti run until the host leaves the screen.
const MEDALS = ['🥇', '🥈', '🥉']
let stopFireworks = () => {}
let podiumTimers = []

function fireworks () {
  const cv = $('fireworks')
  const ctx = cv.getContext('2d')
  const fit = () => { cv.width = innerWidth; cv.height = innerHeight }
  fit(); addEventListener('resize', fit)
  cv.hidden = false
  let parts = []; let rockets = []; let raf = 0; let last = 0; let nextBurst = 0
  const burst = (x, y, hue) => {
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2; const v = 1.5 + Math.random() * 5.5
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: hue + Math.random() * 50, r: 1.5 + Math.random() * 2.5 })
    }
  }
  const confetti = () => {
    for (let i = 0; i < 2; i++) parts.push({ x: Math.random() * cv.width, y: -10, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2.5, life: 1.6, hue: Math.random() * 360, r: 3 + Math.random() * 3, c: true })
  }
  const frame = (t) => {
    const dt = Math.min(2, (t - last) / 16.7 || 1); last = t
    ctx.clearRect(0, 0, cv.width, cv.height)
    if (t > nextBurst) { // launch a rocket that explodes at the top of its climb
      const x = cv.width * (0.08 + Math.random() * 0.84)
      rockets.push({ x, y: cv.height, vy: -(9 + Math.random() * 4), hue: Math.random() * 360, top: cv.height * (0.12 + Math.random() * 0.4) })
      nextBurst = t + 350 + Math.random() * 500
    }
    rockets = rockets.filter((r) => {
      r.y += r.vy * dt
      ctx.globalAlpha = 1; ctx.fillStyle = `hsl(${r.hue} 100% 80%)`
      ctx.beginPath(); ctx.arc(r.x, r.y, 3, 0, 7); ctx.fill()
      if (r.y > r.top) return true
      burst(r.x, r.y, r.hue); return false
    })
    confetti()
    parts = parts.filter((p) => p.life > 0 && p.y < cv.height + 20)
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt
      p.vy += (p.c ? 0.02 : 0.07) * dt
      if (!p.c) { p.vx *= 0.985; p.life -= 0.011 * dt } else p.life -= 0.003 * dt
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life))
      ctx.fillStyle = `hsl(${p.hue} 90% 62%)`
      if (p.c) ctx.fillRect(p.x, p.y, p.r * 1.6, p.r)
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill() }
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', fit); cv.hidden = true; ctx.clearRect(0, 0, cv.width, cv.height) }
}

function stopFinale () {
  podiumTimers.forEach(clearTimeout); podiumTimers = []
  stopFireworks(); stopFireworks = () => {}
  document.body.classList.remove('finale')
}

function renderFinal (top) {
  stopFinale()
  const still = false // projector: always animated, even if the laptop has OS animations off
  document.body.classList.add('finale')
  // Visual order 2 - 1 - 3; with fewer players the missing steps are just skipped.
  const order = [1, 0, 2].filter((i) => top[i])
  $('podium').replaceChildren(...order.map((i) => {
    const r = top[i]
    const d = document.createElement('div')
    d.className = `pod pod-${i + 1}`
    d.innerHTML = '<div class="who"><span class="crown" aria-hidden="true">👑</span><span class="medal"></span><span class="pn"></span><span class="ps"></span></div><div class="step"><span class="place"></span></div>'
    d.querySelector('.who').prepend(avatarEl(r.v, 'pod-av'))
    d.querySelector('.medal').textContent = MEDALS[i]
    d.querySelector('.pn').textContent = r.n
    d.querySelector('.ps').textContent = `${r.s} pts`
    d.querySelector('.place').textContent = i + 1
    // 3rd rises first, the winner last.
    const at = still ? 0 : [3000, 1600, 200][i]
    d.style.setProperty('--at', `${at}ms`)
    if (!still) podiumTimers.push(setTimeout(() => countUp(d.querySelector('.ps'), 0, r.s, 1200, (n) => `${n} pts`), at + 700))
    return d
  }))
  $('final-rest').replaceChildren(...top.slice(3).map((r, k) => {
    const li = document.createElement('li')
    li.innerHTML = '<span class="rk"></span><span class="n"></span><span class="s"></span>'
    li.querySelector('.rk').textContent = k + 4
    li.querySelector('.n').textContent = r.n
    li.querySelector('.n').before(avatarEl(r.v))
    li.querySelector('.s').textContent = r.s
    li.style.setProperty('--at', `${still ? 0 : 3600 + k * 120}ms`)
    return li
  }))
  if (!still) podiumTimers.push(setTimeout(() => { stopFireworks = fireworks() }, 2500))
}

// Lobby: everyone who joined walks left and right around an arena, taking small
// hops and, now and then, a backflip. Cards are placed by script every frame.
const LANES = 4
const LANE_GAP = 70 // px between rows; rows further down draw on top
const LANE_TOP = 95 // room above the first row for backflips
const lobbyCards = new Map()
let lobbyRaf = 0
let lobbyLast = 0

// Each avatar decides on its own what to do next: walk left or right for a
// while, stand still, hop on the spot, or throw a backflip.
function nextMove (w, t) {
  const r = Math.random()
  w.jump = null
  if (r < 0.4) {
    w.kind = 'walk'; w.dir = Math.random() < 0.5 ? -1 : 1; w.speed = 30 + Math.random() * 70
    w.until = t + 700 + Math.random() * 2600
    if (Math.random() < 0.4) w.jump = { t0: t, dur: 420, h: 12 + Math.random() * 10 } // a hop in the stride
  } else if (r < 0.62) {
    w.kind = 'pause'; w.until = t + 500 + Math.random() * 2200
  } else if (r < 0.88) {
    const hops = 1 + Math.floor(Math.random() * 3)
    w.kind = 'hop'; w.hops = hops; w.until = t + hops * 440
    w.jump = { t0: t, dur: 420, h: 14 + Math.random() * 12 }
  } else {
    w.kind = 'flip'; w.until = t + 950
    w.jump = { t0: t, dur: 900, h: 70, flip: true }
  }
}

function stepLobby (t) {
  lobbyRaf = 0
  if ($('screen-lobby').hidden || !lobbyCards.size) return
  const W = $('lobby-players').clientWidth
  const dt = Math.min(0.05, (t - (lobbyLast || t)) / 1000); lobbyLast = t
  for (const w of lobbyCards.values()) {
    if (t >= w.until) nextMove(w, t)
    if (w.kind === 'walk') {
      w.x += w.dir * w.speed * dt
      const max = Math.max(0, W - 96)
      if (w.x < 0) { w.x = 0; w.dir = 1 } else if (w.x > max) { w.x = max; w.dir = -1 }
    }
    let y = 0; let rot = 0
    if (w.jump) {
      const u = Math.min(1, (t - w.jump.t0) / w.jump.dur)
      y = -4 * w.jump.h * u * (1 - u)
      // Backflip: leans back against the walking direction, a full turn in mid-air.
      if (w.jump.flip) rot = -w.dir * 360 * (u < 0.15 ? 0 : u > 0.85 ? 1 : (u - 0.15) / 0.7)
      if (u >= 1) w.jump = w.kind === 'hop' && t + 420 < w.until ? { t0: t, dur: 420, h: 14 + Math.random() * 12 } : null
    }
    w.li.style.transform = `translate3d(${w.x.toFixed(1)}px, ${(LANE_TOP + w.lane * LANE_GAP + y).toFixed(1)}px, 0)`
    w.flip.style.transform = `rotate(${rot.toFixed(1)}deg)`
  }
  lobbyRaf = requestAnimationFrame(stepLobby)
}

function renderLobby (who) {
  const arena = $('lobby-players')
  const names = new Set(who.map(([n]) => n))
  for (const [n, w] of lobbyCards) {
    if (!names.has(n)) { w.li.remove(); lobbyCards.delete(n) }
  }
  for (const [n, v] of who) {
    if (lobbyCards.has(n)) continue
    const li = document.createElement('li')
    const pop = document.createElement('div')
    pop.className = 'pop'
    const flip = document.createElement('span')
    flip.className = 'flip'
    flip.append(avatarEl(v))
    const s = document.createElement('span')
    s.className = 'nm'
    s.textContent = n
    pop.append(flip, s)
    li.append(pop)
    const now = performance.now()
    const lane = lobbyCards.size % LANES
    li.style.zIndex = lane
    arena.append(li)
    lobbyCards.set(n, {
      li, flip, lane, jump: null, kind: 'pause', dir: Math.random() < 0.5 ? -1 : 1, speed: 40,
      x: Math.random() * Math.max(0, arena.clientWidth - 96), until: now + Math.random() * 1500,
    })
  }
  if (!lobbyRaf && lobbyCards.size) lobbyRaf = requestAnimationFrame(stepLobby)
}

function onMessage (m, send) {
  sendFn = send
  if (m.t !== 'final') stopFinale()
  switch (m.t) {
    case 'error':
      $('auth-text').textContent = 'Session expirée : reconnectez-vous à l\'administration, puis rechargez cette page.'
      show('auth')
      break
    case 'lobby':
      stopTimer(); current = null
      show('lobby'); setPhase('lobby')
      if (!lobbyRaf && lobbyCards.size) lobbyRaf = requestAnimationFrame(stepLobby)
      break
    case 'tally':
      $('lobby-count').textContent = m.online
      if (m.who) renderLobby(m.who)
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
      showBoard()
      break
    }
    case 'final':
      stopTimer()
      renderFinal(m.top)
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
