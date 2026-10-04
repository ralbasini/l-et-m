import { json } from '../cors.js'

// Site-wide switches, stored in D1 so every visitor sees the same value.
// menuPublic: whether Galerie / Photos show in the site menu for everyone,
// not just logged-in admins (see src/admin-access.js on the main site).
// maxPerPerson: how many photos one guest may have in their folder (0 closes uploads).
const DEFAULTS = { menuPublic: false, maxPerPerson: 10 }
const MAX_PER_PERSON_CEILING = 1000

async function readSettings (env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all()
  const settings = { ...DEFAULTS }
  for (const { key, value } of results) {
    if (key in DEFAULTS) settings[key] = JSON.parse(value)
  }
  return settings
}

// Used by the guest routes. Lowering it never removes anyone's photos: a guest
// already above it just has nothing left to upload (remaining = max(0, …)).
export async function getMaxPerPerson (env) {
  return (await readSettings(env)).maxPerPerson
}

// Public, no auth.
export async function getSettings (request, env) {
  return json(await readSettings(env), { headers: { 'Cache-Control': 'no-store' } })
}

// POST { menuPublic?: boolean, maxPerPerson?: integer } — admin only (adminOnly() in index.js). Only
// known keys with the right type are stored; anything else is ignored.
export async function updateSettings (request, env) {
  const body = await request.json().catch(() => ({}))
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof body[key] !== typeof fallback) continue
    if (key === 'maxPerPerson' && !(Number.isInteger(body[key]) && body[key] >= 0 && body[key] <= MAX_PER_PERSON_CEILING)) {
      return json({ error: `La limite doit être un nombre entier entre 0 et ${MAX_PER_PERSON_CEILING}.` }, { status: 400 })
    }
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(key, JSON.stringify(body[key])).run()
  }
  return json(await readSettings(env))
}
