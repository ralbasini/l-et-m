import { connect, countdown, countUp, SHAPES } from '../socket.js'
import qrcode from 'qrcode-generator'
import { avatarEl } from '../avatar.js'
import { perform } from '../roam.js'

// Host page: the big screen. Same key the admin page stores its login under
// (see src/admin-access.js) — being logged in there is what makes you the host.
const ADMIN_TOKEN_KEY = 'lm_admin_token'
const $ = (id) => document.getElementById(id)
const screens = [...document.querySelectorAll('.screen')]
const show = (id) => screens.forEach((s) => { s.hidden = s.id !== `screen-${id}` })

// Administrators (a guest account with admin rights logs in with the admin password) get the
// admin token, which is what authorises the host. No token: offer the login screen.
$('auth-login').addEventListener('click', async () => {
  try {
    const gate = await import('../../gate.js')
    await gate.requireGuest({ login: true })
    location.reload()
  } catch { /* cancelled */ }
})

let token = ''
try { token = localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { /* ignore */ }

let sendFn = () => {}
let stopTimer = () => {}
let current = null // the question being shown
let lastReveal = null // the latest reveal message, which also carries the leaderboard
let boardTimers = []
let avatarStops = [] // stop functions of the hopping avatars (leaderboard, podium)
let phase = 'lobby'

// The address guests type or scan: the site's /quiz, without a trailing slash.
const joinUrl = new URL('..', location.href).href.replace(/\/$/, '')
$('join-url').textContent = joinUrl.replace(/^https?:\/\//, '')
const qr = qrcode(0, 'M')
qr.addData(joinUrl)
qr.make()
$('join-qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true })

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

// A picture answer: the image fills the top of the block, the label sits under it.
function optionImage (src, alt) {
  const img = document.createElement('img')
  img.src = src; img.alt = alt; img.draggable = false
  return img
}

function optionBlocks (box, options, extra, images) {
  box.replaceChildren(...options.map((text, i) => {
    const d = document.createElement('div')
    d.className = `opt opt-${i}`
    d.innerHTML = '<span class="shape" aria-hidden="true"></span><span class="label"></span><span class="num"></span>'
    d.querySelector('.shape').textContent = SHAPES[i]
    d.querySelector('.label').textContent = text
    if (images && images[i]) d.prepend(optionImage(images[i], text))
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
  // No leaderboard after the last question: the podium is the surprise.
  const last = m.q + 1 >= m.total
  $('board-title').hidden = last
  $('b-board').hidden = last
  $('board-teaser').hidden = !last
  if (last) return
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
    else if (r.r === 2) li.classList.add('second')
    else if (r.r === 3) li.classList.add('third')
  })

  if (still) return settle()
  // Two beats: first the points land, then the rows slide into their new order.
  later(() => rows.forEach((r, i) => {
    if (r.d > 0) { items[i].querySelector('.gain').textContent = `+${r.d}`; items[i].classList.add('scored') }
  }), 500)
  later(settle, 1400)
  // Once the rows have settled, the avatars start hopping about (an occasional backflip too).
  later(() => items.forEach((li) => avatarStops.push(perform(li.querySelector('.avatar'), { flip: 0.35, gap: [1000, 3500], height: 0.7, lift: li }))), 2800)
}

// ── Final podium ──────────────────────────────────────────────
// 2nd-1st-3rd blocks rise one after the other (3rd, 2nd, then the winner),
// then fireworks and confetti run until the host leaves the screen.
const MEDAL_COLORS = [['#f6df8a', '#c9a23c'], ['#eef1f0', '#9fb0ac'], ['#efc29a', '#a8693a']]
const medalSvg = (i) => {
  const [a, b] = MEDAL_COLORS[i]
  return `<svg class="medal-acc" viewBox="0 0 40 52" aria-hidden="true"><path d="M8 0 L20 22 L32 0 L26 0 L20 10 L14 0z" fill="#d6455d"/><path d="M14 0 L20 10 L26 0z" fill="#b8324a"/><circle cx="20" cy="33" r="15" fill="${b}"/><circle cx="20" cy="33" r="12" fill="${a}" stroke="${b}" stroke-width="1.5"/><text x="20" y="39" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="17" fill="${b}">${i + 1}</text></svg>`
}
let stopFireworks = () => {}
let podiumTimers = []

// Falling confetti: coloured paper, with the odd chili and half-wheel of raclette.
// The two food sprites are drawn once to small canvases, then just stamped.
function makeSprites () {
  const chili = document.createElement('canvas')
  chili.width = chili.height = 34
  const c1 = chili.getContext('2d')
  c1.font = '26px sans-serif'; c1.textAlign = 'center'; c1.textBaseline = 'middle'
  c1.fillText('🌶️', 17, 18)
  const cheese = document.createElement('canvas')
  cheese.width = cheese.height = 34
  const c2 = cheese.getContext('2d')
  c2.translate(17, 21)
  c2.beginPath(); c2.arc(0, 0, 14, Math.PI, 0); c2.closePath()
  c2.fillStyle = '#f7cf4a'; c2.fill()
  c2.lineWidth = 3; c2.strokeStyle = '#d99a1c'; c2.stroke()
  c2.fillStyle = '#e0a928'
  for (const [hx, hy, hr] of [[-6, -4, 2.4], [3, -8, 2], [6, -2, 2.8], [-1, -2, 1.6]]) { c2.beginPath(); c2.arc(hx, hy, hr, 0, 7); c2.fill() }
  return { chili, cheese }
}

function fireworks () {
  const cv = $('fireworks')
  const ctx = cv.getContext('2d')
  const fit = () => { cv.width = innerWidth; cv.height = innerHeight }
  fit(); addEventListener('resize', fit)
  cv.hidden = false
  const sprites = makeSprites()
  let parts = []; let raf = 0; let last = 0
  const spawn = () => {
    const r = Math.random()
    parts.push({
      x: Math.random() * cv.width, y: -20, vx: (Math.random() - 0.5) * 1.6, vy: 1.5 + Math.random() * 2.2,
      hue: Math.random() * 360, w: 6 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.2,
      k: r < 0.05 ? 'chili' : r < 0.1 ? 'cheese' : null,
    })
  }
  const frame = (t) => {
    const dt = Math.min(2, (t - last) / 16.7 || 1); last = t
    ctx.clearRect(0, 0, cv.width, cv.height)
    if (parts.length < 140) for (let i = 0; i < 2; i++) spawn()
    parts = parts.filter((p) => p.y < cv.height + 30)
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt
      ctx.setTransform(Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot), Math.cos(p.rot), p.x, p.y)
      if (p.k) ctx.drawImage(sprites[p.k], -17, -17)
      else { ctx.fillStyle = `hsl(${p.hue} 90% 62%)`; ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2) }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', fit); cv.hidden = true; ctx.clearRect(0, 0, cv.width, cv.height) }
}

function stopFinale () {
  avatarStops.forEach((f) => f()); avatarStops = []
  podiumTimers.forEach(clearTimeout); podiumTimers = []
  stopFireworks(); stopFireworks = () => {}
  document.body.classList.remove('finale')
}

// A blue Subaru Impreza with yellow stars drifts back and forth behind the podium.
function driftingCar () {
  const d = document.createElement('div')
  d.className = 'drift'
  d.setAttribute('aria-hidden', 'true')
  d.innerHTML = '<div class="drift-car"><img src="/quiz-img/impreza.svg" alt="" draggable="false"><span class="smoke s1"></span><span class="smoke s2"></span><span class="smoke s3"></span></div>'
  return d
}

function renderFinal (top) {
  stopFinale()
  const still = false // projector: always animated, even if the laptop has OS animations off
  document.body.classList.add('finale')
  // Visual order 2 - 1 - 3; with fewer players the missing steps are just skipped.
  const order = [1, 0, 2].filter((i) => top[i])
  $('podium').replaceChildren(driftingCar(), ...order.map((i) => {
    const r = top[i]
    const d = document.createElement('div')
    d.className = `pod pod-${i + 1}`
    d.innerHTML = '<div class="who"><span class="pn"></span></div><div class="step"><span class="place"></span><span class="ps"></span></div>'
    // The medal hangs on the avatar like an accessory, so it moves with every hop and flip.
    const av = avatarEl(r.v, 'pod-av')
    av.insertAdjacentHTML('beforeend', medalSvg(i))
    d.querySelector('.who').prepend(av)
    d.querySelector('.pn').textContent = r.n
    d.querySelector('.ps').textContent = `${r.s} pts`
    d.querySelector('.place').textContent = i + 1
    // 3rd rises first, the winner last.
    const at = still ? 0 : [3000, 1600, 200][i]
    d.style.setProperty('--at', `${at}ms`)
    podiumTimers.push(setTimeout(() => avatarStops.push(perform(d.querySelector('.pod-av'), { flip: 0.65, gap: [400, 1800] })), at + 1700))
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
// More players, more rows (about 18 per row on a wide screen), so the crowd stays readable.
const lanesFor = (n) => Math.min(8, Math.max(4, Math.ceil(n / 18)))
const LANE_GAP = 70 // px between rows; rows further down draw on top
const LANE_TOP = 95 // room above the first row for backflips
const lobbyCards = new Map()
let lobbyRaf = 0
let lobbyLast = 0

// Everyone who joined stays on screen, but only MAX_ANIMATED avatars move at a
// time; the rest stand still (a still avatar costs the browser almost nothing).
// Measured with 100 moving avatars: ~80% of a 4x-slower CPU, a 30-avatar lobby ~38%.
// Which ones move changes every SWAP_MS, so nobody stays frozen for long.
const MAX_ANIMATED = 40
// Past this many players the names would pile up into an unreadable smear, so they
// are hidden (the avatars and the "N joueurs connectés" count stay).
const MAX_NAMES = 20
const SWAP_MS = 6000
const animated = new Set()
let lobbySwapAt = 0

function setPose (w, y, rot) {
  w.li.style.transform = `translate3d(${w.x.toFixed(1)}px, ${(LANE_TOP + w.lane * LANE_GAP + y).toFixed(1)}px, 0)`
  w.flip.style.transform = `rotate(${rot.toFixed(1)}deg)`
}

// A card leaving the animated set stops where it is, upright.
function rest (w) {
  w.kind = 'pause'; w.jump = null; w.until = Infinity
  setPose(w, 0, 0)
  animated.delete(w)
}

function animate (w) {
  w.until = 0 // picks its first move on the next frame
  animated.add(w)
}

function rotateAnimated () {
  const all = [...lobbyCards.values()]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]]
  }
  const next = new Set(all.slice(0, MAX_ANIMATED))
  for (const w of [...animated]) if (!next.has(w)) rest(w)
  for (const w of next) if (!animated.has(w)) animate(w)
}

// Each avatar decides on its own what to do next: walk left or right for a
// while, stand still, hop on the spot, or throw a backflip.
function nextMove (w, t) {
  const r = Math.random()
  w.jump = null
  if (r < 0.4) {
    w.kind = 'walk'; w.dir = Math.random() < 0.5 ? -1 : 1; w.speed = 30 + Math.random() * 70
    w.until = t + 700 + Math.random() * 2600
    if (Math.random() < 0.4) w.jump = { t0: t, dur: 420, h: 12 + Math.random() * 10 } // a hop in the stride
  } else if (r < 0.52) {
    w.kind = 'pause'; w.until = t + 500 + Math.random() * 2200
  } else if (r < 0.7) {
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
  if (lobbyCards.size > MAX_ANIMATED && t >= lobbySwapAt) { lobbySwapAt = t + SWAP_MS; rotateAnimated() }
  for (const w of animated) {
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
    // Walking: a small rock from side to side, clockwise then anticlockwise, on its own beat.
    if (w.kind === 'walk' && !(w.jump && w.jump.flip)) rot += Math.sin(t / 110 + w.phase) * 7
    setPose(w, y, rot)
  }
  lobbyRaf = requestAnimationFrame(stepLobby)
}

function renderLobby (who) {
  const arena = $('lobby-players')
  const names = new Set(who.map(([n]) => n))
  for (const [n, w] of lobbyCards) {
    if (!names.has(n)) { w.li.remove(); lobbyCards.delete(n); animated.delete(w) }
  }
  for (const [n, v] of who) {
    const known = lobbyCards.get(n)
    if (known) {
      const key = JSON.stringify(v)
      if (known.key !== key) { known.key = key; known.flip.replaceChildren(avatarEl(v)) }
      continue
    }
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
    li.title = n
    const now = performance.now()
    const lanes = lanesFor(lobbyCards.size + 1)
    const lane = lobbyCards.size % lanes
    arena.style.height = `${LANE_TOP + lanes * LANE_GAP + 90}px`
    li.style.zIndex = lane
    arena.append(li)
    const card = {
      li, flip, lane, jump: null, phase: Math.random() * 6.28, key: JSON.stringify(v), kind: 'pause', dir: Math.random() < 0.5 ? -1 : 1, speed: 40,
      x: Math.random() * Math.max(0, arena.clientWidth - 96), until: now + Math.random() * 1500,
    }
    lobbyCards.set(n, card)
    setPose(card, 0, 0) // standing cards are never touched again by the animation loop
    // A newcomer starts moving right away; if the stage is full, one other avatar takes a rest.
    if (animated.size >= MAX_ANIMATED) rest([...animated][Math.floor(Math.random() * animated.size)])
    animated.add(card)
  }
  arena.classList.toggle('crowded', lobbyCards.size > MAX_NAMES)
  // Someone left: let a standing avatar take the free place.
  for (const w of lobbyCards.values()) {
    if (animated.size >= MAX_ANIMATED) break
    if (!animated.has(w)) animate(w)
  }
  if (!lobbyRaf && lobbyCards.size) lobbyRaf = requestAnimationFrame(stepLobby)
}

function onMessage (m, send) {
  sendFn = send
  if (['lobby', 'question', 'reveal'].includes(m.t)) stopFinale() // not on 'tally', which keeps arriving
  switch (m.t) {
    case 'error':
      $('auth-text').textContent = "Session expirée : reconnectez-vous avec un compte administrateur."
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
      optionBlocks($('q-options'), m.options, null, m.images)
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
      }, m.images)
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
