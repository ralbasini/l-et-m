import { json } from '../cors.js'
import { signToken } from '../auth.js'
import { registerFolderPath, storePhoto, deletePhotoRows } from '../files.js'
import { getMaxPerPerson } from './settings.js'

// The per-person limit is a site setting (routes/settings.js, set from the
// admin dashboard) and is sent to the client as maxPerPerson (src/photos/main.js
// builds its label from it). Every handler except identify is wrapped in
// guestOnly() by the route table in index.js, which passes the guest row as
// the third argument.

// Scoped by *folder*, not by guest_id: the README documents the original
// PHP behavior as recalculating the quota from what's actually left in the
// guest's folder, not a separate counter — so if the admin moves one of
// this guest's photos elsewhere (e.g. curating the best ones into a
// top-level folder), it stops counting against their quota and stops
// showing in "their" photos, exactly like moving a file out of a directory
// would. guest_id is kept only as an audit trail of who originally
// uploaded a photo, not as the source of truth for what's currently theirs.
async function guestState (env, guest) {
  const { results } = await env.DB.prepare(
    'SELECT filename FROM photos WHERE folder = ? ORDER BY uploaded_at'
  ).bind(guestFolder(guest.name)).all()
  const photos = results.map((r) => r.filename)
  const maxPerPerson = await getMaxPerPerson(env)
  return {
    name: guest.name,
    maxPerPerson,
    // Never negative: a guest above a lowered limit keeps every photo, they
    // just can't add more.
    remaining: Math.max(0, maxPerPerson - photos.length),
    photos,
  }
}

function guestFolder (name) {
  return `Invités/${name}`
}

// POST { name } or POST { confirm_name }. Mirrors identify.php: a name
// that's already taken returns a 'collision' status instead of an error, so
// the client can offer "Oui, c'est moi" (same guest, another device) before
// giving up and asking for a different name.
export async function identify (request, env) {
  const body = await request.json().catch(() => ({}))
  const confirmName = (body.confirm_name || '').trim()
  const wanted = confirmName || (body.name || '').trim()
  if (!wanted) return json({ error: 'Merci d’indiquer un nom.' }, { status: 400 })

  const existing = await env.DB.prepare('SELECT id, name FROM guests WHERE name = ?').bind(wanted).first()

  if (existing && !confirmName) {
    return json({ status: 'collision', pendingName: wanted })
  }

  let guest = existing
  if (!guest) {
    await env.DB.prepare('INSERT INTO guests (name) VALUES (?)').bind(wanted).run()
    guest = await env.DB.prepare('SELECT id, name FROM guests WHERE name = ?').bind(wanted).first()
  }

  const token = await signToken(env.GUEST_TOKEN_SECRET, { guestId: guest.id })
  return json({ token, name: guest.name })
}

export async function me (request, env, guest) {
  return json(await guestState(env, guest))
}

// The client already sends one file per request (see the comment on
// uploadBatch() in src/photos/main.js) and pre-checks its own quota before
// calling — the check here is just defense in depth, not the primary gate.
export async function upload (request, env, guest) {
  const before = await guestState(env, guest)
  if (before.remaining <= 0) {
    return json({ uploaded: 0, errors: [`Limite de ${before.maxPerPerson} photos par personne atteinte.`], ...before })
  }

  const formData = await request.formData()
  const allFiles = formData.getAll('photos[]').filter((f) => f instanceof File)
  // Defense in depth for a request carrying several files: only what's left.
  const files = allFiles.slice(0, before.remaining)
  const folder = guestFolder(guest.name)
  await registerFolderPath(env.DB, folder)
  const errors = allFiles.length > files.length ? [`Limite de ${before.maxPerPerson} photos par personne atteinte.`] : []
  let uploaded = 0

  for (const file of files) {
    const error = await storePhoto(env, folder, file, guest.id, files.length === 1 ? formData.get('thumb') : null)
    if (error) errors.push(error)
    else uploaded += 1
  }

  return json({ uploaded, errors, ...(await guestState(env, guest)) })
}

export async function deletePhoto (request, env, guest) {
  const { file } = await request.json().catch(() => ({}))
  const folder = guestFolder(guest.name)
  // Folder-scoped, not guest_id-scoped (see the comment on guestState): a
  // guest can delete anything currently in their folder, matching exactly
  // what /me shows them as "their" photos — not restricted to photos this
  // exact guest_id uploaded, since e.g. an admin-placed file in their
  // folder would otherwise be listed but silently fail to delete.
  const row = await env.DB.prepare(
    'SELECT id, r2_key FROM photos WHERE folder = ? AND filename = ?'
  ).bind(folder, file).first()

  if (row) await deletePhotoRows(env, [row])

  return json(await guestState(env, guest))
}
