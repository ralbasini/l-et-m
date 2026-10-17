#!/usr/bin/env node
// Plays a full quiz with N simulated phones and checks the game's invariants.
// Run it against `wrangler dev` or, before the big day, the deployed Worker:
//
//   QUIZ_WS_URL='wss://<your-worker>/quiz/ws?room=test' PLAYERS=100 \
//   ADMIN_TOKEN_SECRET=<the secret> node scripts/quiz-load-test.mjs
//
// (ADMIN_TOKEN_SECRET mints a host token; or pass a real one as ADMIN_TOKEN,
// e.g. localStorage.lm_admin_token after logging in at /admin.)
// Use a throw-away ?room= so the test never touches the real game's scores.

import { readFileSync } from 'node:fs'
import { signToken } from '../src/auth.js'

const URL_ = process.env.QUIZ_WS_URL || 'ws://127.0.0.1:8787/quiz/ws?room=loadtest'
const N = Number(process.env.PLAYERS || 100)
const QUESTIONS = JSON.parse(readFileSync(new URL('../src/quiz/questions.json', import.meta.url)))
const token = process.env.ADMIN_TOKEN || await signToken(process.env.ADMIN_TOKEN_SECRET || 'dev-only-admin-secret-change-me', { role: 'admin' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check (cond, label) { if (!cond) { failures++; console.error('FAIL:', label) } }

class Client {
  constructor (label) { this.label = label; this.log = []; this.waiters = [] }
  async open () {
    this.ws = new WebSocket(URL_)
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      this.log.push(m)
      this.waiters = this.waiters.filter((w) => {
        if (w.t === m.t && w.fn(m)) { w.res(m); return false }
        return true
      })
    }
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('connect failed: ' + this.label)) })
  }

  send (m) { this.ws.send(JSON.stringify(m)) }
  last (t, fn = () => true) { return [...this.log].reverse().find((m) => m.t === t && fn(m)) }
  // Resolves with the first matching message, including one that already arrived.
  next (t, fn = () => true, ms = 15000) {
    const seen = this.last(t, fn)
    if (seen) return Promise.resolve(seen)
    return new Promise((res, rej) => {
      this.waiters.push({ t, fn, res })
      setTimeout(() => rej(new Error(`${this.label}: timed out waiting for ${t}`)), ms)
    })
  }
}

const host = new Client('host')
await host.open()
host.send({ t: 'host', token })
await host.next('lobby')
host.send({ t: 'cmd', c: 'reset' })
await sleep(300)

// Connect all players (staggered a little, like people scanning the QR code).
let players = []
const t0 = Date.now()
const runId = Math.random().toString(36).slice(2, 8)
for (let i = 0; i < N; i++) {
  const c = new Client('p' + i)
  c.pid = `lt-${runId}-${String(i).padStart(4, '0')}`
  c.name = 'Joueur ' + i
  await c.open()
  c.send({ t: 'join', pid: c.pid, name: c.name, av: [i % 8, Math.floor(i / 8) % 8, Math.floor(i / 64) % 8] })
  players.push(c)
  if (i % 20 === 19) await sleep(50)
}
await Promise.all(players.map((c) => c.next('joined')))
console.log(`${N} players joined in ${Date.now() - t0} ms`)

// A duplicate name is refused.
{
  const dup = new Client('dup'); await dup.open()
  dup.send({ t: 'join', pid: `dup-${runId}-0001`, name: 'joueur 3', av: [7, 7, 7] })
  check((await dup.next('error')).code === 'name_taken', 'duplicate name is rejected')
  dup.ws.close()
  const dup2 = new Client('dup2'); await dup2.open()
  dup2.send({ t: 'join', pid: `dup-${runId}-0002`, name: 'Nouveau', av: [3 % 8, 0, 0] })
  check((await dup2.next('error')).code === 'avatar_taken', 'duplicate avatar is rejected')
  dup2.ws.close()
}
await sleep(300)
check(host.last('tally').players === N, `host sees ${N} players (saw ${host.last('tally').players})`)

const latencies = []
host.send({ t: 'cmd', c: 'start' })

for (let q = 0; q < QUESTIONS.length; q++) {
  const qd = QUESTIONS[q]
  const qMsgs = await Promise.all(players.map((c) => c.next('question', (m) => m.q === q)))
  check(qMsgs.every((m) => !('correct' in m)), `question ${q} never leaks the answer`)

  // Each phone answers after a random 0.2-2.5 s; ~60% pick the right one.
  const picks = players.map(() => (Math.random() < 0.6 ? qd.correct : (qd.correct + 1) % qd.options.length))
  const dropIdx = Math.floor(N / 2) // this phone loses its connection during question 1
  await Promise.all(players.map(async (c, i) => {
    await sleep(200 + Math.random() * 2300)
    if (i === dropIdx && q === 0) {
      c.ws.close(); await sleep(150)
      const back = new Client(c.label)
      back.pid = c.pid; back.name = c.name
      await back.open()
      back.send({ t: 'join', pid: c.pid, name: 'ignored-on-rejoin' })
      check((await back.next('question')).q === 0, 'a reconnecting phone gets the live question back')
      players[i] = back
      c = back
    }
    const sent = Date.now()
    c.send({ t: 'answer', q, c: picks[i] })
    await c.next('ack', (m) => m.q === q)
    latencies.push(Date.now() - sent)
    c.send({ t: 'answer', q, c: (picks[i] + 1) % qd.options.length }) // a second answer must be ignored
  }))

  const reveal = await host.next('reveal', (m) => m.q === q)
  const counted = reveal.counts.reduce((a, b) => a + b, 0)
  check(reveal.correct === qd.correct, 'reveal carries the right answer')
  check(counted === N, `all ${N} answers counted (got ${counted})`)
  check(reveal.counts[qd.correct] === picks.filter((p) => p === qd.correct).length, 'host counts match what players sent')
  check(reveal.board.length === Math.min(8, N) && reveal.board[0].r === 1, 'reveal carries a leaderboard topped by rank 1')
  check(reveal.board.every((r, i, a) => i === 0 || a[i - 1].s >= r.s), 'leaderboard rows are sorted by score')
  check(reveal.board.every((r) => r.pr >= 1 && r.s >= r.d && (q > 0 || r.pr >= 1)), 'leaderboard rows carry previous rank and earned points')

  const results = await Promise.all(players.map((c) => c.next('result', (m) => m.q === q)))
  results.forEach((r, i) => {
    const right = picks[i] === qd.correct
    check(right ? r.delta >= 500 && r.delta <= 1000 : r.delta === 0, `player ${i} delta ${r.delta} matches correctness`)
    check(r.choice === picks[i], `player ${i}'s first answer is the one recorded`)
  })
  console.log(`q${q + 1}: ${reveal.counts.join(' / ')} (correct #${qd.correct})`)
  host.send({ t: 'cmd', c: 'next' })
}

const final = await host.next('final')
const playerFinals = await Promise.all(players.map((c) => c.next('final')))
check(final.top.every((r) => Array.isArray(r.v) && r.v.length === 3), 'leaderboard rows carry an avatar')
check(final.top.length === Math.min(10, N), 'host gets a top 10')
check(final.top.every((r, i, a) => i === 0 || a[i - 1].s >= r.s), 'leaderboard is sorted')
check(playerFinals.every((f) => f.of === N && f.rank >= 1 && f.rank <= N), 'every player gets a rank')
check(playerFinals.some((f) => f.rank === 1), 'someone is ranked first')

latencies.sort((a, b) => a - b)
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]
console.log(`answer ack latency: median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, max ${latencies.at(-1)} ms`)
console.log(`winner: ${final.top[0].n} with ${final.top[0].s} points`)

host.send({ t: 'cmd', c: 'reset' })
await sleep(300)
;[host, ...players].forEach((c) => c.ws.close())
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
