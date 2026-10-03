import { json } from './cors.js'

// Minimal signed-token helper: base64url(JSON payload) + '.' + a base64url HMAC of
// that string, keyed by a Worker secret. Same shape for guest and admin
// tokens (different secrets), verified fresh on every request — there's no
// session store, so nothing to look up or expire server-side.

function base64UrlEncode (bytes) {
  let str = ''
  bytes.forEach((b) => { str += String.fromCharCode(b) })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode (str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const bin = atob(str)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function hmac (secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return base64UrlEncode(new Uint8Array(sig))
}

export async function signToken (secret, payload) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmac(secret, body)
  return `${body}.${sig}`
}

export async function verifyToken (secret, token) {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = await hmac(secret, body)
  if (expected !== sig) return null
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(body)))
  } catch {
    return null
  }
}

export function getBearerToken (request) {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/^Bearer (.+)$/)
  return match ? match[1] : ''
}

// Route guards, applied in index.js's route table rather than inside each
// handler, so a new route can't forget its check. guestOnly passes the
// guest row ({ id, name }) to the handler as a third argument.
export function adminOnly (handler) {
  return async (request, env) => {
    const payload = await verifyToken(env.ADMIN_TOKEN_SECRET, getBearerToken(request))
    if (!payload || payload.role !== 'admin') return json({ error: 'Non autorisé.' }, { status: 401 })
    return handler(request, env)
  }
}

export function guestOnly (handler) {
  return async (request, env) => {
    const payload = await verifyToken(env.GUEST_TOKEN_SECRET, getBearerToken(request))
    const guest = payload && payload.guestId
      ? await env.DB.prepare('SELECT id, name FROM guests WHERE id = ?').bind(payload.guestId).first()
      : null
    if (!guest) return json({ error: 'Session expirée, merci de recommencer.' }, { status: 401 })
    return handler(request, env, guest)
  }
}
