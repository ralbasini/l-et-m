import { json } from '../cors.js'
import { signToken } from '../auth.js'
import { registerFolderPath, storePhoto, deletePhotoRows } from '../files.js'
import { getMaxPerPerson } from './settings.js'
import { verifyAdminPassword } from './admin.js'
import { parseAvatar, avatarKey, avatarFromKey, cleanName } from '../avatar.js'

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
    avatar: avatarFromKey(guest.avatar),
    isAdmin: Boolean(guest.is_admin),
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

// POST { name, avatar: [animal, colour, accessory] } creates the account, or logs back in
// when both match an existing one. One
// account per name (ignoring case); avatars may repeat. Guests from
// before avatars existed have no avatar yet: they may claim their name once.
export async function identify (request, env) {
  const body = await request.json().catch(() => ({}))
  const name = cleanName(body.name)
  const avatar = parseAvatar(body.avatar)
  if (!name) return json({ error: 'Merci d’indiquer un prénom.' }, { status: 400 })
  if (!avatar) return json({ error: 'Créez votre personnage.' }, { status: 400 })

  const existing = await env.DB.prepare('SELECT id, name, avatar, is_admin FROM guests WHERE name = ? COLLATE NOCASE').bind(name).first()
  const key = avatarKey(avatar)

  // An account with admin rights is never reachable with just a name and an avatar: the
  // admin password proves it is really them (and then also hands out the admin token).
  let adminToken = null
  if (existing && existing.is_admin) {
    if (!body.password) return json({ code: 'password_required', error: 'Compte administrateur : entrez le mot de passe.' }, { status: 401 })
    const refused = await verifyAdminPassword(request, env, body.password)
    if (refused) return refused
    adminToken = await signToken(env.ADMIN_TOKEN_SECRET, { role: 'admin' })
    await env.DB.prepare('UPDATE guests SET avatar = ? WHERE id = ?').bind(key, existing.id).run()
    const token = await signToken(env.GUEST_TOKEN_SECRET, { guestId: existing.id })
    return json({ token, adminToken, name: existing.name, avatar, resumed: true })
  }

  if (existing && existing.avatar) {
    // Same name and same avatar: this is the guest coming back (new phone, cleared browser).
    // The avatar acts as the password; anything else is a different person wanting the name.
    if (existing.avatar === key) {
      const token = await signToken(env.GUEST_TOKEN_SECRET, { guestId: existing.id })
      return json({ token, name: existing.name, avatar: avatarFromKey(existing.avatar), resumed: true })
    }
    return json({ code: 'name_taken', error: 'Ce prénom est déjà pris. Si c’est vous, recréez exactement votre personnage pour vous reconnecter ; sinon ajoutez par exemple une initiale.' }, { status: 409 })
  }

  try {
    if (existing) await env.DB.prepare('UPDATE guests SET avatar = ? WHERE id = ?').bind(key, existing.id).run()
    else await env.DB.prepare('INSERT INTO guests (name, avatar) VALUES (?, ?)').bind(name, key).run()
  } catch {
    // Lost a race on the unique name.
    return json({ code: 'name_taken', error: 'Ce prénom vient d’être pris, essayez autre chose.' }, { status: 409 })
  }
  const guest = await env.DB.prepare('SELECT id, name, avatar FROM guests WHERE name = ? COLLATE NOCASE').bind(name).first()
  const token = await signToken(env.GUEST_TOKEN_SECRET, { guestId: guest.id })
  return json({ token, name: guest.name, avatar: avatarFromKey(guest.avatar) })
}

// POST { avatar } — change one's own avatar.
export async function setAvatar (request, env, guest) {
  const body = await request.json().catch(() => ({}))
  const avatar = parseAvatar(body.avatar)
  if (!avatar) return json({ error: 'Personnage invalide.' }, { status: 400 })
  const key = avatarKey(avatar)
  await env.DB.prepare('UPDATE guests SET avatar = ? WHERE id = ?').bind(key, guest.id).run()
  return json({ avatar })
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
