import { DurableObject } from 'cloudflare:workers'
import { verifyToken } from '../auth.js'
import QUESTIONS from './questions.json'
import { avatarFromKey } from '../avatar.js'
import { isQuizEnabled } from '../routes/settings.js'

// One game room (a Durable Object). The host drives it (start / reveal / next),
// players join with their guest login (name + avatar live in D1, shared with the photo page) and answer; the server owns the clock and the
// scoring, so a slow phone can't change its own timing. State is written to
// the object's storage as it changes, because a hibernated object (no
// messages for a while) loses its memory but must still know the scores.
//
// Wire format: JSON text frames, always { t: <type>, ... }.
//   client -> server: host {token} | join {token} | refresh | answer {q,c} | cmd {c} | ping
//   server -> client: lobby | question | ack | tally | reveal | result | final | error

const MAX_PLAYERS = 300
const DEFAULT_SECONDS = 20
const MAX_POINTS = 1000
const ANSWER_GRACE_MS = 1500 // network latency allowance on top of the timer

const OPEN = 1
const secondsOf = (i) => QUESTIONS[i].seconds || DEFAULT_SECONDS

export class QuizRoom extends DurableObject {
  constructor (ctx, env) {
    super(ctx, env)
    this.phase = 'lobby' // lobby | question | reveal | ended
    this.q = -1
    this.startedAt = 0
    this.endsAt = 0
    this.players = new Map() // pid -> { n: name, s: score, d: last delta, a: { [q]: [choice, ms] } }
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('game')
      if (saved) Object.assign(this, saved)
      for (const [key, p] of await ctx.storage.list({ prefix: 'p:' })) this.players.set(key.slice(2), p)
    })
  }

  async fetch (request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ role: null })
    return new Response(null, { status: 101, webSocket: client })
  }

  // ── Persistence ───────────────────────────────────────────
  saveGame () {
    return this.ctx.storage.put('game', { phase: this.phase, q: this.q, startedAt: this.startedAt, endsAt: this.endsAt })
  }

  savePlayer (pid) {
    return this.ctx.storage.put(`p:${pid}`, this.players.get(pid))
  }

  async saveAllPlayers () {
    const entries = [...this.players].map(([pid, p]) => [`p:${pid}`, p])
    for (let i = 0; i < entries.length; i += 100) {
      await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 100)))
    }
  }

  // ── Sockets ───────────────────────────────────────────────
  openSockets (role) {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === OPEN && (ws.deserializeAttachment() || {}).role === role)
  }

  onlinePids () {
    return new Set(this.openSockets('player').map((ws) => ws.deserializeAttachment().pid))
  }

  send (ws, msg) {
    try { ws.send(JSON.stringify(msg)) } catch { /* socket already gone */ }
  }

  toHosts (msg) {
    const text = JSON.stringify(msg)
    for (const ws of this.openSockets('host')) { try { ws.send(text) } catch { /* ignore */ } }
  }

  toPlayers (build) {
    for (const ws of this.openSockets('player')) {
      const { pid } = ws.deserializeAttachment()
      const p = this.players.get(pid)
      if (p) this.send(ws, build(pid, p))
    }
  }

  // ── Derived views ─────────────────────────────────────────
  leaderboard (limit) {
    return [...this.players.values()]
      .sort((a, b) => b.s - a.s || a.n.localeCompare(b.n))
      .slice(0, limit)
      .map((p) => ({ n: p.n, s: p.s, v: p.v }))
  }

  // Rows for the host's animated leaderboard: who is on top now, what each
  // player just earned (d), and the rank they held before this question (pr),
  // so the page can slide each row from its old place to its new one.
  boardRows (limit) {
    return [...this.players.values()]
      .sort((a, b) => b.s - a.s || a.n.localeCompare(b.n))
      .slice(0, limit)
      .map((p) => { const r = this.rankOf(p); return { n: p.n, s: p.s, v: p.v, d: p.d, r, pr: p.pr ?? r } })
  }

  rankOf (p) {
    let ahead = 0
    // Ties are broken by name, like the leaderboard order, so every player has a distinct place
    // and a climb past a tied player still counts as one.
    for (const o of this.players.values()) if (o.s > p.s || (o.s === p.s && o.n.localeCompare(p.n) < 0)) ahead++
    return ahead + 1
  }

  answeredCount () {
    if (this.phase !== 'question') return 0
    let n = 0
    for (const p of this.players.values()) if (p.a[this.q]) n++
    return n
  }

  questionMsg () {
    const qd = QUESTIONS[this.q]
    // Never includes `correct` — that only goes out with the reveal.
    return {
      t: 'question', q: this.q, total: QUESTIONS.length, text: qd.text, options: qd.options, images: qd.images || null, image: qd.image || null,
      seconds: secondsOf(this.q), remaining: Math.max(0, this.endsAt - Date.now()),
    }
  }

  revealMsg () {
    const qd = QUESTIONS[this.q]
    const counts = qd.options.map(() => 0)
    for (const p of this.players.values()) if (p.a[this.q]) counts[p.a[this.q][0]]++
    return { t: 'reveal', q: this.q, total: QUESTIONS.length, text: qd.text, options: qd.options, images: qd.images || null, correct: qd.correct, counts, players: this.players.size, board: this.boardRows(8) }
  }

  // The player's place with the two players above and the two below (fewer at the ends).
  // Same order as the leaderboard: score, then name, so the places match everywhere.
  around (p, span = 2) {
    const sorted = [...this.players.values()].sort((a, b) => b.s - a.s || a.n.localeCompare(b.n))
    const i = sorted.indexOf(p)
    const from = Math.max(0, i - span)
    return sorted.slice(from, i + span + 1).map((o, k) => ({ n: o.n, s: o.s, v: o.v, r: from + k + 1, me: o === p }))
  }

  resultMsg (p) {
    const qd = QUESTIONS[this.q]
    const a = p.a[this.q]
    return {
      t: 'result', q: this.q, total: QUESTIONS.length, correct: qd.correct, choice: a ? a[0] : null,
      delta: p.d, score: p.s, rank: this.rankOf(p), prev: p.pr ?? this.rankOf(p), of: this.players.size,
      // After the last question the standings stay secret until the final screen.
      around: this.q + 1 < QUESTIONS.length ? this.around(p) : null,
    }
  }

  finalMsgFor (p) {
    return { t: 'final', score: p.s, rank: this.rankOf(p), of: this.players.size, top: this.leaderboard(5) }
  }

  tallyMsg () {
    const online = this.onlinePids()
    const msg = { t: 'tally', players: this.players.size, online: online.size, answered: this.answeredCount() }
    // In the lobby the host shows who has joined (avatar + name).
    if (this.phase === 'lobby') msg.who = [...online].map((pid) => this.players.get(pid)).filter(Boolean).map((p) => [p.n, p.v])
    return msg
  }

  // The current screen, for someone who just connected or reconnected.
  sendState (ws, role, pid) {
    const p = pid && this.players.get(pid)
    if (this.phase === 'lobby') this.send(ws, { t: 'lobby', total: QUESTIONS.length })
    else if (this.phase === 'question') {
      this.send(ws, this.questionMsg())
      if (p && p.a[this.q]) this.send(ws, { t: 'ack', q: this.q, c: p.a[this.q][0] })
    } else if (this.phase === 'reveal') {
      this.send(ws, role === 'host' ? this.revealMsg() : p ? this.resultMsg(p) : this.revealMsg())
    } else if (role === 'host') this.send(ws, { t: 'final', top: this.leaderboard(10), of: this.players.size })
    else if (p) this.send(ws, this.finalMsgFor(p))
    if (role === 'host') this.send(ws, this.tallyMsg())
  }

  // ── Incoming messages ─────────────────────────────────────
  async webSocketMessage (ws, raw) {
    if (typeof raw !== 'string' || raw.length > 2000) return
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (!msg || typeof msg !== 'object') return
    const att = ws.deserializeAttachment() || {}

    if (msg.t === 'ping') return this.send(ws, { t: 'pong' })
    if (msg.t === 'host') return this.onHost(ws, msg)
    if (msg.t === 'join') return this.onJoin(ws, att, msg)
    if (msg.t === 'refresh' && att.role === 'player') return this.onRefresh(ws, att)
    if (msg.t === 'answer' && att.role === 'player') return this.onAnswer(ws, att.pid, msg)
    if (msg.t === 'cmd' && att.role === 'host') return this.onCommand(msg.c)
  }

  async webSocketClose (ws) {
    try { ws.close() } catch { /* already closed */ }
    this.toHosts(this.tallyMsg())
  }

  async webSocketError (ws) {
    await this.webSocketClose(ws)
  }

  async onHost (ws, msg) {
    const payload = await verifyToken(this.env.ADMIN_TOKEN_SECRET, String(msg.token || ''))
    if (!payload || payload.role !== 'admin') {
      this.send(ws, { t: 'error', code: 'unauthorized' })
      return ws.close(4401, 'unauthorized')
    }
    ws.serializeAttachment({ role: 'host' })
    this.sendState(ws, 'host')
  }

  // The guest account (D1) is the identity: name and avatar come from there, so the
  // quiz, the photo page and the admin's user list always agree.
  async guestFor (token) {
    const payload = await verifyToken(this.env.GUEST_TOKEN_SECRET, String(token || ''))
    if (!payload || !payload.guestId) return null
    const g = await this.env.DB.prepare('SELECT id, name, avatar FROM guests WHERE id = ?').bind(payload.guestId).first()
    return g && g.avatar ? { id: g.id, name: g.name, v: avatarFromKey(g.avatar) } : null
  }

  async onJoin (ws, att, msg) {
    const g = await this.guestFor(msg.token)
    if (!g) return this.send(ws, { t: 'error', code: 'login_required' })
    if (!(await isQuizEnabled(this.env))) return this.send(ws, { t: 'error', code: 'quiz_disabled' })

    const pid = `g${g.id}`
    let p = this.players.get(pid)
    if (!p) {
      if (this.players.size >= MAX_PLAYERS) return this.send(ws, { t: 'error', code: 'full' })
      p = { n: g.name, s: 0, d: 0, a: {}, v: g.v }
      this.players.set(pid, p)
      await this.savePlayer(pid)
    } else if (p.n !== g.name || (p.v || []).join('.') !== g.v.join('.')) {
      p.n = g.name; p.v = g.v // renamed or restyled since the last visit
      await this.savePlayer(pid)
    }
    ws.serializeAttachment({ role: 'player', pid, gid: g.id })
    this.send(ws, { t: 'joined', name: p.n })
    this.sendState(ws, 'player', pid)
    this.toHosts(this.tallyMsg())
  }

  // The player changed their avatar on the account: pick it up from D1.
  async onRefresh (ws, att) {
    const p = this.players.get(att.pid)
    const row = att.gid && await this.env.DB.prepare('SELECT name, avatar FROM guests WHERE id = ?').bind(att.gid).first()
    const v = row && avatarFromKey(row.avatar)
    if (!p || !v) return
    p.n = row.name; p.v = v
    await this.savePlayer(att.pid)
    this.send(ws, { t: 'profile', name: p.n, av: v })
    this.toHosts(this.tallyMsg())
  }

  async onAnswer (ws, pid, msg) {
    if (this.phase !== 'question' || msg.q !== this.q) return
    const p = this.players.get(pid)
    if (!p || p.a[this.q]) return // unknown player, or already answered
    const choice = msg.c
    if (!Number.isInteger(choice) || choice < 0 || choice >= QUESTIONS[this.q].options.length) return
    const ms = Date.now() - this.startedAt
    if (ms > secondsOf(this.q) * 1000 + ANSWER_GRACE_MS) return

    p.a[this.q] = [choice, ms]
    await this.savePlayer(pid)
    this.send(ws, { t: 'ack', q: this.q, c: choice })
    this.toHosts(this.tallyMsg())

    // Everyone who is connected has answered: no point waiting for the timer.
    const online = this.onlinePids()
    let allIn = online.size > 0
    for (const id of online) if (!this.players.get(id)?.a[this.q]) allIn = false
    if (allIn) await this.reveal()
  }

  async onCommand (cmd) {
    if (cmd === 'start' && this.phase === 'lobby') return this.startQuestion(0)
    if (cmd === 'reveal') return this.reveal()
    if (cmd === 'next' && this.phase === 'reveal') {
      return this.q + 1 < QUESTIONS.length ? this.startQuestion(this.q + 1) : this.end()
    }
    if (cmd === 'reset') return this.reset()
  }

  // ── Game flow ─────────────────────────────────────────────
  async startQuestion (i) {
    this.phase = 'question'
    this.q = i
    this.startedAt = Date.now()
    this.endsAt = this.startedAt + secondsOf(i) * 1000
    await this.saveGame()
    await this.ctx.storage.setAlarm(this.endsAt)
    const msg = this.questionMsg()
    for (const ws of this.ctx.getWebSockets()) if (ws.readyState === OPEN && (ws.deserializeAttachment() || {}).role) this.send(ws, msg)
    this.toHosts(this.tallyMsg())
  }

  async alarm () {
    if (this.phase !== 'question') return
    if (Date.now() >= this.endsAt - 100) await this.reveal()
    else await this.ctx.storage.setAlarm(this.endsAt)
  }

  async reveal () {
    if (this.phase !== 'question') return
    const qd = QUESTIONS[this.q]
    const windowMs = secondsOf(this.q) * 1000
    // Ranks before this question's points, for the leaderboard animation.
    const before = new Map()
    for (const [pid, p] of this.players) before.set(pid, this.rankOf(p))
    for (const [pid, p] of this.players) {
      p.pr = before.get(pid)
      const a = p.a[this.q]
      // Kahoot-style: full points for an instant right answer, half for the last-second one.
      p.d = a && a[0] === qd.correct ? Math.round(MAX_POINTS * (1 - Math.min(a[1] / windowMs, 1) / 2)) : 0
      p.s += p.d
    }
    this.phase = 'reveal'
    await this.ctx.storage.deleteAlarm()
    await this.saveGame()
    await this.saveAllPlayers()
    this.toHosts(this.revealMsg())
    this.toPlayers((pid, p) => this.resultMsg(p))
  }

  async end () {
    this.phase = 'ended'
    await this.saveGame()
    this.toHosts({ t: 'final', top: this.leaderboard(10), of: this.players.size })
    this.toPlayers((pid, p) => this.finalMsgFor(p))
  }

  // Back to the lobby: scores and answers cleared, players who are still
  // connected stay joined, and those who have left are dropped — otherwise a
  // rehearsal's leftover names would stay taken for the real game.
  async reset () {
    this.phase = 'lobby'
    this.q = -1
    const online = this.onlinePids()
    for (const pid of [...this.players.keys()]) {
      if (online.has(pid)) continue
      this.players.delete(pid)
      await this.ctx.storage.delete(`p:${pid}`)
    }
    for (const p of this.players.values()) { p.s = 0; p.d = 0; p.a = {}; delete p.pr }
    await this.ctx.storage.deleteAlarm()
    await this.saveGame()
    await this.saveAllPlayers()
    for (const ws of this.ctx.getWebSockets()) if (ws.readyState === OPEN && (ws.deserializeAttachment() || {}).role) this.send(ws, { t: 'lobby', total: QUESTIONS.length })
    this.toHosts(this.tallyMsg())
  }
}
