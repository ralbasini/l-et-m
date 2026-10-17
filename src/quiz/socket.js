import { API_BASE_URL } from '../photos.js'

// A WebSocket that reconnects by itself (venue wifi drops, phones lock and
// wake). `onOpen` runs on every (re)connection, which is where the page
// re-identifies itself so the server can hand back the current screen.
// ?room=xyz in the page URL picks another room (handy for rehearsals).
const room = new URLSearchParams(location.search).get('room')
// Same Worker as every other call (src/photos.js): `wrangler dev` on localhost, the deployed one
// otherwise, or the deployed one from localhost with ?api=prod.
const WS_URL = API_BASE_URL.replace(/^http/, 'ws') + 'quiz/ws' + (room ? `?room=${encodeURIComponent(room)}` : '')

export function connect ({ onOpen, onMessage, onStatus = () => {} }) {
  let ws
  let retries = 0
  let pingTimer

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)) }

  function open () {
    ws = new WebSocket(WS_URL)
    ws.onopen = () => {
      retries = 0
      onStatus(true)
      onOpen(send)
      // Keeps phones' mobile-data connections from being silently dropped.
      pingTimer = setInterval(() => send({ t: 'ping' }), 30000)
    }
    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      onMessage(msg, send)
    }
    ws.onclose = () => {
      clearInterval(pingTimer)
      onStatus(false)
      setTimeout(open, Math.min(500 * 2 ** retries++, 6000))
    }
  }

  // Coming back to the tab: reconnect right away rather than waiting for the backoff.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!ws || ws.readyState > 1)) open()
  })

  open()
  return send
}

// "12 s" countdown driven by the server's `remaining`, so a wrong phone clock
// can't skew it. Calls tick(secondsLeft, fraction) until it reaches 0.
export function countdown (remainingMs, totalMs, tick) {
  const start = performance.now()
  const id = setInterval(() => {
    const left = Math.max(0, remainingMs - (performance.now() - start))
    tick(Math.ceil(left / 1000), left / totalMs)
    if (left <= 0) clearInterval(id)
  }, 100)
  tick(Math.ceil(remainingMs / 1000), remainingMs / totalMs)
  return () => clearInterval(id)
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Counts a number up from rom to 	o (eased), writing it to el via fmt.
// Jumps straight to the end for people who asked for less motion.
export function countUp (el, from, to, ms, fmt = String) {
  if (reducedMotion() || from === to) { el.textContent = fmt(to); return }
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms)
    el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - t) ** 3)))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export const SHAPES = ['▲', '◆', '●', '■']
