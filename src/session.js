import { API_BASE_URL } from './photos.js'

// The guest account, shared by the photo page and the quiz: a bearer token in
// localStorage (see cloudflare/src/routes/guest.js), plus the name and avatar
// cached next to it so pages can show them before the server answers.
export const GUEST_TOKEN_KEY = 'lm_guest_token'
const NAME_KEY = 'lm_guest_name'
const AVATAR_KEY = 'lm_guest_avatar'

const read = (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function getSession () {
  let avatar = null
  try { avatar = JSON.parse(read(AVATAR_KEY)) } catch { /* none */ }
  return { token: read(GUEST_TOKEN_KEY), name: read(NAME_KEY), avatar: Array.isArray(avatar) ? avatar : null }
}

export function saveSession ({ token, name, avatar }) {
  if (token) write(GUEST_TOKEN_KEY, token)
  if (name) write(NAME_KEY, name)
  if (avatar) write(AVATAR_KEY, JSON.stringify(avatar))
  document.documentElement.classList.add('is-guest') // shows the account menu
}

export function clearSession () {
  try { [GUEST_TOKEN_KEY, NAME_KEY, AVATAR_KEY].forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
  document.documentElement.classList.remove('is-guest')
}

class SessionError extends Error {
  constructor (message, code = '') { super(message); this.code = code }
}

async function call (path, { method = 'GET', body, token } = {}) {
  let res
  try {
    res = await fetch(API_BASE_URL + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new SessionError('Connexion impossible, réessayez.', 'network')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new SessionError(data.error || 'Erreur, réessayez.', data.code || String(res.status))
  return data
}

// null when there is no valid session. If the network is down we trust what is cached.
export async function fetchMe () {
  const s = getSession()
  if (!s.token) return null
  try {
    const me = await call('guest/me', { token: s.token })
    saveSession({ ...s, name: me.name, avatar: me.avatar })
    return { token: s.token, name: me.name, avatar: me.avatar }
  } catch (err) {
    if (err.code === '401') { clearSession(); return null }
    return s.avatar ? s : null
  }
}

export async function register (name, avatar) {
  const data = await call('guest/identify', { method: 'POST', body: { name, avatar } })
  saveSession(data)
  return data
}

export async function updateAvatar (avatar) {
  const s = getSession()
  const data = await call('guest/avatar', { method: 'POST', body: { avatar }, token: s.token })
  saveSession({ ...s, avatar: data.avatar })
  return getSession()
}
