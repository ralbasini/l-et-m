import { API_BASE_URL } from '../photos.js'

// A WebSocket that reconnects by itself (venue wifi drops, phones lock and
// wake). `onOpen` runs on every (re)connection, which is where the page
// re-identifies itself so the server can hand back the current screen.
// ?room=xyz in the page URL picks another room (handy for rehearsals).
const room = new URLSearchParams(location.search).get('room')
// Opened from localhost, it talks to `wrangler dev` (port 8787) instead of the deployed Worker.
const local = ['localhost', '127.0.0.1'].includes(location.hostname)
const WS_URL = (local ? 'ws://127.0.0.1:8787/' : API_BASE_URL.replace(/^http/, 'ws')) + 'quiz/ws' + (room ? `?room=${encodeURIComponent(room)}` : '')

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

export const SHAPES = ['▲', '◆', '●', '■']
