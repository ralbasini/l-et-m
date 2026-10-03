import { json } from '../cors.js'
import { verifyToken, getBearerToken } from '../auth.js'

// Site-wide switches, stored in D1 so every visitor sees the same value.
// menuPublic: whether Galerie / Photos show in the site menu for everyone,
// not just logged-in admins (see src/admin-access.js on the main site).
const DEFAULTS = { menuPublic: false }

async function readSettings (env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all()
  const settings = { ...DEFAULTS }
  for (const { key, value } of results) {
    if (key in DEFAULTS) settings[key] = JSON.parse(value)
  }
  return settings
}

// Public, no auth.
export async function getSettings (request, env) {
  return json(await readSettings(env), { headers: { 'Cache-Control': 'no-store' } })
}

// POST { menuPublic: boolean } — admin only. Only known keys with the
// right type are stored; anything else is ignored.
export async function updateSettings (request, env) {
  const payload = await verifyToken(env.ADMIN_TOKEN_SECRET, getBearerToken(request))
  if (!payload || payload.role !== 'admin') {
    return json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof body[key] !== typeof fallback) continue
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(key, JSON.stringify(body[key])).run()
  }
  return json(await readSettings(env))
}
