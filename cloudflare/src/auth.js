// Minimal signed-token helper: base64url(JSON payload) + '.' + a hex HMAC of
// that string, keyed by a Worker secret. Same shape for guest and admin
// tokens (different secrets), verified fresh on every request — there's no
// session store, so nothing to look up or expire server-side. This mirrors
// what the PHP backend already did (see the "bearer token ... HMAC
// signature, verified server-side" comment in the guest upload page).

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

async function hmacHex (secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return base64UrlEncode(new Uint8Array(sig))
}

export async function signToken (secret, payload) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacHex(secret, body)
  return `${body}.${sig}`
}

export async function verifyToken (secret, token) {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = await hmacHex(secret, body)
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
