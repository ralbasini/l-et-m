import { ANIMALS, ACCESSORIES, COLORS, avatarEl, accessoryEl, randomAvatar } from './quiz/avatar.js'

// Avatar picker: an animal, a fur colour and an accessory. Each chip draws what
// choosing it gives, so the options preview themselves. Used by the login screen.
// Returns { get, set } — get() is the current [animal, colour, accessory].
export function mountBuilder (box, initial, onChange = () => {}, { collapsed = false } = {}) {
  let av = Array.isArray(initial) ? [...initial] : randomAvatar()
  box.innerHTML = `
    <div class="av-preview" data-ref="preview"></div>
    <div class="av-options" data-ref="options"${collapsed ? ' hidden' : ''}>
      <div class="av-group"><span class="av-label">Animal</span><div class="av-choices" data-ref="animals"></div></div>
      <div class="av-group"><span class="av-label" data-ref="colorLabel">Pelage</span><div class="av-choices" id="av-colors" data-ref="colors"></div></div>
      <div class="av-group"><span class="av-label">Accessoire</span><div class="av-choices" data-ref="acc"></div></div>
    </div>
    <div class="av-actions">
      <button type="button" class="ghost" data-ref="random">🎲 Au hasard</button>
      ${collapsed ? '<button type="button" class="ghost" data-ref="toggle">Modifier mon avatar</button>' : ''}
    </div>`
  const ref = (n) => box.querySelector(`[data-ref="${n}"]`)

  function chip (label, pressed, onClick, child) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `chip${pressed ? ' on' : ''}`
    b.title = label
    b.setAttribute('aria-label', label)
    b.setAttribute('aria-pressed', String(pressed))
    b.append(child)
    b.addEventListener('click', onClick)
    return b
  }
  function render () {
    ref('preview').replaceChildren(avatarEl(av, 'xl bump'))
    ref('colorLabel').textContent = `Pelage · ${COLORS[av[1]].name}`
    ref('animals').replaceChildren(...ANIMALS.map((n, i) => chip(n, av[0] === i, () => pick(0, i), avatarEl([i, av[1], 0]))))
    ref('colors').replaceChildren(...COLORS.map((c, i) => {
      const sw = document.createElement('span')
      sw.className = 'swatch'
      sw.style.background = c.swatch || `radial-gradient(circle at 32% 30%, ${c.light}, ${c.fur} 62%)`
      sw.style.borderColor = c.dark
      return chip(c.name, av[1] === i, () => pick(1, i), sw)
    }))
    ref('acc').replaceChildren(...ACCESSORIES.map((n, i) => {
      let child
      if (i === 0) { child = document.createElement('span'); child.className = 'none'; child.textContent = '∅' } else child = accessoryEl(i)
      return chip(n, av[2] === i, () => pick(2, i), child)
    }))
  }
  function pick (slot, i) { av[slot] = i; render(); onChange(av) }
  ref('random').addEventListener('click', () => { av = randomAvatar(); render(); onChange(av) })
  const toggle = ref('toggle')
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = ref('options').hidden
      ref('options').hidden = !open
      toggle.textContent = open ? 'Masquer les réglages' : 'Modifier mon avatar'
    })
  }
  render()
  return { get: () => [...av], set: (v) => { av = [...v]; render() } }
}
