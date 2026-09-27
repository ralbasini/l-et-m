const pages = ['mariage', 'galerie', 'photos']
const shell = document.getElementById('app-shell')

async function initializeWeddingEmbed () {
  const themeScripts = [
    'jquery.min.js',
    'jquery.scrollex.min.js',
    'jquery.scrolly.min.js',
    'browser.min.js',
    'breakpoints.min.js',
    'util.js',
    'main.js',
  ].map((file) => `${import.meta.env.BASE_URL}mariage/assets/js/${file}`)

  for (const src of themeScripts) {
    await new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = resolve
      script.onerror = resolve
      document.body.appendChild(script)
    })
  }

  await import('./site-swipe-nav.js')
}

if (window.parent !== window) {
  if (new URLSearchParams(location.search).get('embed') === 'mariage') initializeWeddingEmbed()
} else if (shell) {
  const nav = shell.querySelector('.site-nav')
  const links = [...nav.querySelectorAll('a[href^="#"]')]
  const track = document.getElementById('panel-track')
  const frames = [...track.querySelectorAll('iframe[data-page]')]
  const framesByPage = new Map(frames.map((frame) => [frame.dataset.page, frame]))

  function ensureLoaded (page) {
    const frame = framesByPage.get(page)
    if (frame && !frame.hasAttribute('src')) frame.src = frame.dataset.src
  }

  function render () {
    const requested = location.hash.slice(1)
    const page = pages.includes(requested) ? requested : 'mariage'
    const index = pages.indexOf(page)

    if (requested !== page) history.replaceState(null, '', `#${page}`)

    track.style.transform = `translate3d(-${index * 100}vw, 0, 0)`
    links.forEach((link) => {
      const active = link.hash === `#${page}`
      link.classList.toggle('is-current', active)
      if (active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
    frames.forEach((frame) => {
      const active = frame.dataset.page === page
      frame.setAttribute('aria-hidden', String(!active))
      frame.tabIndex = active ? 0 : -1
    })

    ensureLoaded(page)
    if (page === 'mariage' || page === 'photos') ensureLoaded('galerie')
    if (page === 'galerie') ensureLoaded('mariage')
    document.body.classList.remove('is-preload')
  }

  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]')
    if (!link || !links.includes(link)) return
    event.preventDefault()
    if (location.hash !== link.hash) location.hash = link.hash
  })

  window.addEventListener('hashchange', render)
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !frames.some((frame) => frame.contentWindow === event.source)) return
    const { type, page } = event.data || {}
    if (type === 'site-nav' && pages.includes(page) && location.hash !== `#${page}`) {
      location.hash = page
    }
  })

  render()
}
