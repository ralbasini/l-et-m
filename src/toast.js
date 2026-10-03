// A transient message in the page's #toast-host (styled in src/ui.css).
export function toast (message, ok, durationMs = 4000) {
  if (!message) return
  const host = document.getElementById('toast-host')
  const el = document.createElement('div')
  el.className = 'toast' + (ok ? ' toast-ok' : '')
  el.textContent = message
  host.appendChild(el)
  setTimeout(() => {
    el.classList.add('toast-hide')
    setTimeout(() => el.remove(), 400)
  }, durationMs)
}
