const nav = document.querySelector('.site-nav')
const links = nav ? [...nav.querySelectorAll('a')] : []

if (links.length > 1) {
  let start = null

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || document.querySelector('#lightbox:not([hidden])')) {
      start = null
      return
    }

    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, select, button, label, [contenteditable="true"], #upload-progress:not([hidden])')) {
      start = null
      return
    }

    const touch = event.touches[0]
    const edge = 24
    if (touch.clientX < edge || touch.clientX > window.innerWidth - edge) {
      start = null
      return
    }

    start = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }, { passive: true })

  document.addEventListener('touchend', (event) => {
    if (!start || event.changedTouches.length !== 1) {
      start = null
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const duration = Date.now() - start.time
    start = null

    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25 || duration > 1200) return

    const currentIndex = links.findIndex((link) => link.classList.contains('is-current'))
    if (currentIndex < 0) return

    const direction = deltaX < 0 ? 1 : -1
    const nextIndex = (currentIndex + direction + links.length) % links.length
    window.location.assign(links[nextIndex].href)
  }, { passive: true })

  document.addEventListener('touchcancel', () => { start = null }, { passive: true })
}