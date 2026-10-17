// Player avatars: [animal, fur colour, accessory], drawn as inline SVG.
// 8 x 13 x 9 = 936 combinations, and the room gives each one to a single player
// (cloudflare/src/quiz/room.js keeps AVATAR_LIMITS in sync with these lists).

export const ANIMALS = ['Lion', 'Chat', 'Chien', 'Ours', 'Lapin', 'Souris', 'Cochon', 'Hibou']
export const ACCESSORIES = ['Aucun', 'Lunettes', 'Lunettes de soleil', 'Haut-de-forme', 'Couronne', 'Chapeau de fête', 'Nœud papillon', 'Fleur', 'Casquette FC Sion']
// [fur, darker shade for ears and mane, lighter shade for muzzle]
export const COLORS = [
  { name: 'Crème', fur: '#f1dcb4', dark: '#d9bf8b', light: '#fbf1da' },
  { name: 'Miel', fur: '#e3ac52', dark: '#c4872c', light: '#f3d08f' },
  { name: 'Roux', fur: '#dd7a43', dark: '#b85a28', light: '#f2b389' },
  { name: 'Chocolat', fur: '#8d5d3d', dark: '#6b4128', light: '#bc8d68' },
  { name: 'Gris', fur: '#aeb5ba', dark: '#8b949a', light: '#d8dde0' },
  { name: 'Neige', fur: '#f7f5f0', dark: '#d9d5cc', light: '#ffffff' },
  { name: 'Ardoise', fur: '#4a4d55', dark: '#33353b', light: '#767a84' },
  { name: 'Rose', fur: '#efb2c3', dark: '#d98ba1', light: '#f9d9e2' },
  { name: 'Bleu ciel', fur: '#8fc7ee', dark: '#5f9fd0', light: '#cfe8f8' },
  { name: 'Menthe', fur: '#9fe0bd', dark: '#62bd8c', light: '#d6f5e5' },
  { name: 'Violet', fur: '#b79be0', dark: '#8d6cc4', light: '#e0d3f5' },
  // Rainbow fur: a gradient (see avatarSvg), with a solid swatch colour for the picker.
  { name: 'Arc-en-ciel', fur: 'rainbow', dark: '#8d6cc4', light: '#fff3d6', swatch: 'conic-gradient(#f26d6d, #f4c95d, #7bd88f, #6ec6f2, #b58ce8, #f26d6d)' },
  // Calico: white with orange and black patches (a pattern, like the rainbow is a gradient).
  { name: 'Lamaya', fur: 'calico', dark: '#e08a3c', light: '#ffffff', swatch: 'radial-gradient(circle at 28% 30%, #e08a3c 0 26%, transparent 28%), radial-gradient(circle at 74% 38%, #2f2f33 0 22%, transparent 24%), radial-gradient(circle at 60% 80%, #e08a3c 0 24%, transparent 26%), #fbf7ee' },
]
export const LIMITS = [ANIMALS.length, COLORS.length, ACCESSORIES.length]

const INK = '#2b2b2f'
const PINK = '#f0a3b4'

// Where the top of the head and the eyes sit, so hats and glasses fit each animal.
const TOP = [14, 28, 26, 26, 36, 28, 26, 24]
const EYE_Y = [50, 50, 50, 50, 58, 50, 50, 46]

const eyes = (y, r = 3.4) =>
  [38, 62].map((x) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${x + 1.1}" cy="${y - 1.2}" r="${r * 0.32}" fill="#fff"/>`).join('')
const whiskers = (y) =>
  [[-1, 0], [-1, 6], [1, 0], [1, 6]].map(([s, d]) => `<path d="M${50 + s * 12} ${y + d / 2} L${50 + s * 36} ${y - 3 + d}" stroke="${INK}" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>`).join('')

const FACES = [
  // Lion: dark mane behind a round face
  (c) => `<circle cx="50" cy="54" r="42" fill="${c.dark}"/><circle cx="23" cy="26" r="8" fill="${c.dark}"/><circle cx="77" cy="26" r="8" fill="${c.dark}"/><circle cx="50" cy="54" r="28" fill="${c.fur}"/><ellipse cx="50" cy="64" rx="14" ry="10" fill="${c.light}"/><path d="M44 58 h12 l-6 7z" fill="${INK}"/><path d="M50 65 v5 M50 70 q-5 4 -9 0 M50 70 q5 4 9 0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>${eyes(50)}`,
  // Chat: pointed ears, whiskers
  (c) => `<path d="M20 44 L24 10 L48 28z M80 44 L76 10 L52 28z" fill="${c.fur}"/><path d="M26 36 L28 19 L40 29z M74 36 L72 19 L60 29z" fill="${PINK}"/><ellipse cx="50" cy="56" rx="32" ry="28" fill="${c.fur}"/><ellipse cx="50" cy="65" rx="11" ry="8" fill="${c.light}"/><path d="M45 58 h10 l-5 6z" fill="${PINK}"/><path d="M50 64 q-4 5 -8 1 M50 64 q4 5 8 1" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>${whiskers(62)}${eyes(50)}`,
  // Chien: floppy ears, long muzzle
  (c) => `<ellipse cx="21" cy="50" rx="10" ry="21" fill="${c.dark}" transform="rotate(10 21 50)"/><ellipse cx="79" cy="50" rx="10" ry="21" fill="${c.dark}" transform="rotate(-10 79 50)"/><circle cx="50" cy="54" r="30" fill="${c.fur}"/><ellipse cx="50" cy="66" rx="16" ry="12" fill="${c.light}"/><ellipse cx="50" cy="60" rx="6.5" ry="4.5" fill="${INK}"/><path d="M50 64 v5 M50 69 q-5 4 -9 0 M50 69 q5 4 9 0" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="75" rx="4" ry="3" fill="${PINK}"/>${eyes(48)}`,
  // Ours: round ears
  (c) => `<circle cx="25" cy="29" r="11" fill="${c.fur}"/><circle cx="75" cy="29" r="11" fill="${c.fur}"/><circle cx="25" cy="29" r="5.5" fill="${c.dark}"/><circle cx="75" cy="29" r="5.5" fill="${c.dark}"/><circle cx="50" cy="55" r="31" fill="${c.fur}"/><ellipse cx="50" cy="65" rx="14" ry="11" fill="${c.light}"/><ellipse cx="50" cy="60" rx="5.5" ry="4" fill="${INK}"/><path d="M50 64 q-4 5 -8 1 M50 64 q4 5 8 1" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>${eyes(48)}`,
  // Lapin: tall ears, buck teeth
  (c) => `<ellipse cx="36" cy="22" rx="8.5" ry="21" fill="${c.fur}" transform="rotate(-8 36 22)"/><ellipse cx="64" cy="22" rx="8.5" ry="21" fill="${c.fur}" transform="rotate(8 64 22)"/><ellipse cx="36" cy="24" rx="4.2" ry="15" fill="${PINK}" transform="rotate(-8 36 24)"/><ellipse cx="64" cy="24" rx="4.2" ry="15" fill="${PINK}" transform="rotate(8 64 24)"/><ellipse cx="50" cy="62" rx="29" ry="26" fill="${c.fur}"/><ellipse cx="50" cy="70" rx="12" ry="8" fill="${c.light}"/><path d="M46 64 h8 l-4 5z" fill="${PINK}"/><path d="M50 69 q-4 4 -7 1 M50 69 q4 4 7 1" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/><rect x="46.5" y="72" width="7" height="6" rx="1.5" fill="#fff" stroke="${INK}" stroke-width="1"/>${eyes(58)}`,
  // Souris: big round ears, tiny pink nose
  (c) => `<circle cx="22" cy="34" r="15" fill="${c.fur}"/><circle cx="78" cy="34" r="15" fill="${c.fur}"/><circle cx="22" cy="34" r="9" fill="${PINK}"/><circle cx="78" cy="34" r="9" fill="${PINK}"/><path d="M50 26 C74 26 80 50 76 66 C72 82 28 82 24 66 C20 50 26 26 50 26z" fill="${c.fur}"/><ellipse cx="50" cy="66" rx="10" ry="7" fill="${c.light}"/><ellipse cx="50" cy="60" rx="4.5" ry="3.4" fill="${PINK}"/><path d="M50 63 q-3 4 -6 1 M50 63 q3 4 6 1" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>${whiskers(62)}${eyes(50)}`,
  // Cochon: folded ears, snout with nostrils
  (c) => `<path d="M24 40 L22 14 L46 28z M76 40 L78 14 L54 28z" fill="${c.dark}"/><circle cx="50" cy="55" r="31" fill="${c.fur}"/><ellipse cx="50" cy="63" rx="14" ry="10.5" fill="${PINK}"/><ellipse cx="44.5" cy="63" rx="2.4" ry="3.4" fill="#b8566f"/><ellipse cx="55.5" cy="63" rx="2.4" ry="3.4" fill="#b8566f"/>${eyes(47)}`,
  // Hibou: ear tufts, big round eyes, beak
  (c) => `<path d="M22 40 L18 12 L42 26z M78 40 L82 12 L58 26z" fill="${c.dark}"/><ellipse cx="50" cy="55" rx="33" ry="31" fill="${c.fur}"/><circle cx="36" cy="48" r="13" fill="#fff"/><circle cx="64" cy="48" r="13" fill="#fff"/><circle cx="36" cy="48" r="13" fill="none" stroke="${c.dark}" stroke-width="3"/><circle cx="64" cy="48" r="13" fill="none" stroke="${c.dark}" stroke-width="3"/><circle cx="37" cy="49" r="5.5" fill="${INK}"/><circle cx="63" cy="49" r="5.5" fill="${INK}"/><circle cx="38.8" cy="47" r="1.8" fill="#fff"/><circle cx="64.8" cy="47" r="1.8" fill="#fff"/><path d="M44 58 L56 58 L50 70z" fill="#e8a23a"/><path d="M34 72 q16 8 32 0" stroke="${c.dark}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`,
]

const ACC = [
  () => '',
  (y) => `<g fill="none" stroke="${INK}" stroke-width="2.2"><circle cx="38" cy="${y}" r="9"/><circle cx="62" cy="${y}" r="9"/><path d="M47 ${y} h6"/></g>`,
  (y) => `<g fill="${INK}"><rect x="27" y="${y - 7}" width="21" height="14" rx="6"/><rect x="52" y="${y - 7}" width="21" height="14" rx="6"/><rect x="47" y="${y - 2}" width="6" height="2.4"/></g><path d="M27 ${y - 3} L18 ${y - 6} M73 ${y - 3} L82 ${y - 6}" stroke="${INK}" stroke-width="2.2"/><path d="M31 ${y - 4} l5 -1 M56 ${y - 4} l5 -1" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>`,
  (_, t) => `<g transform="translate(0 ${t - 24})"><rect x="33" y="2" width="34" height="23" rx="2" fill="${INK}"/><rect x="33" y="17" width="34" height="5" fill="#b8483c"/><rect x="22" y="24" width="56" height="6" rx="3" fill="${INK}"/></g>`,
  (_, t) => `<g transform="translate(0 ${t - 24})"><path d="M31 28 L28 6 L41 16 L50 2 L59 16 L72 6 L69 28z" fill="#f2c94c" stroke="#c99a1e" stroke-width="1.6" stroke-linejoin="round"/><circle cx="50" cy="19" r="2.8" fill="#d6455d"/><circle cx="38" cy="22" r="1.9" fill="#4aa3a2"/><circle cx="62" cy="22" r="1.9" fill="#4aa3a2"/></g>`,
  (_, t) => `<g transform="translate(0 ${t - 24})"><path d="M35 28 L50 -2 L65 28z" fill="#e8789a"/><path d="M41 17 L59 17 M38 23 L62 23" stroke="#fff" stroke-width="2.4" opacity=".75"/><circle cx="50" cy="-2" r="4.5" fill="#f2c94c"/></g>`,
  () => `<g><path d="M50 90 L32 80 L32 100z M50 90 L68 80 L68 100z" fill="#c4473d"/><circle cx="50" cy="90" r="5" fill="#9e2f27"/></g>`,
  (_, t) => `<g transform="translate(${70} ${t + 2})">${[0, 72, 144, 216, 288].map((a) => `<circle cx="${(Math.cos((a * Math.PI) / 180) * 6).toFixed(1)}" cy="${(Math.sin((a * Math.PI) / 180) * 6).toFixed(1)}" r="5" fill="#f4a7c0"/>`).join('')}<circle r="3.6" fill="#f2c94c"/></g>`,
  (_, t) => `<g transform="translate(0 ${t - 24})"><path d="M28 30 C28 6 72 6 72 30z" fill="#d6202f"/><path d="M34 29 C34 11 66 11 66 29z" fill="#fff"/><text x="50" y="26" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="8" letter-spacing=".4" fill="#d6202f">SION</text><circle cx="50" cy="9" r="2.4" fill="#a8141f"/><path d="M22 31 Q50 40 78 31 Q50 25 22 31z" fill="#a8141f"/></g>`,
]

let gradientId = 0
export function avatarSvg (v) {
  const [a, c, x] = Array.isArray(v) ? v : [0, 5, 0]
  let col = COLORS[c] || COLORS[0]
  let defs = ''
  if (col.fur === 'calico') {
    const id = `lm-ca${gradientId++}`
    defs = `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="100" height="104"><rect width="100" height="104" fill="#fbf7ee"/><ellipse cx="30" cy="34" rx="19" ry="14" fill="#e08a3c" transform="rotate(-20 30 34)"/><ellipse cx="74" cy="42" rx="12" ry="14" fill="#2f2f33"/><ellipse cx="62" cy="82" rx="17" ry="11" fill="#e08a3c" transform="rotate(15 62 82)"/><circle cx="22" cy="74" r="9" fill="#2f2f33"/><circle cx="84" cy="16" r="9" fill="#e08a3c"/><circle cx="50" cy="14" r="6" fill="#2f2f33"/></pattern></defs>`
    col = { ...col, fur: `url(#${id})` }
  } else if (col.fur === 'rainbow') {
    // One id per drawing: a gradient defined inside a hidden screen would not resolve.
    const id = `lm-rb${gradientId++}`
    defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f26d6d"/><stop offset=".25" stop-color="#f4c95d"/><stop offset=".5" stop-color="#7bd88f"/><stop offset=".75" stop-color="#6ec6f2"/><stop offset="1" stop-color="#b58ce8"/></linearGradient></defs>`
    col = { ...col, fur: `url(#${id})` }
  }
  const face = FACES[a] || FACES[0]
  const acc = ACC[x] || ACC[0]
  return `<svg viewBox="0 -12 100 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${defs}${face(col)}${acc(EYE_Y[a] ?? 50, TOP[a] ?? 26)}</svg>`
}

// An accessory on its own (for the picker), cropped to where it sits on a head.
const ACC_VIEW = [null, '14 34 72 32', '14 36 72 28', '20 2 60 32', '26 2 48 30', '30 -2 40 34', '28 76 44 28', '56 14 28 28', '20 4 60 42']
export function accessoryEl (x) {
  const el = document.createElement('span')
  el.className = 'acc-icon'
  el.innerHTML = `<svg viewBox="${ACC_VIEW[x]}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${ACC[x](50, 26)}</svg>`
  return el
}

// A <span class="avatar"> holding the drawing; sized by CSS.
export function avatarEl (v, className = '') {
  const el = document.createElement('span')
  el.className = `avatar ${className}`.trim()
  el.innerHTML = avatarSvg(v)
  return el
}

export const randomAvatar = () => LIMITS.map((n) => Math.floor(Math.random() * n))
