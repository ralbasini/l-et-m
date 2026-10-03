// The basename gets non [a-zA-Z0-9_-] characters replaced with '-', and the
// extension is lowercased (src/photos/main.js's serverNamePattern matches
// exactly this sanitization).
export function safeFilename (originalName) {
  const dot = originalName.lastIndexOf('.')
  const rawBase = dot === -1 ? originalName : originalName.slice(0, dot)
  const ext = dot === -1 ? '' : originalName.slice(dot + 1).toLowerCase()
  const base = rawBase.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo'
  return ext ? `${base}.${ext}` : base
}

// Appends -2, -3, ... on collision, checked against D1 rather than the
// filesystem (there's no directory listing in object storage).
export async function uniqueFilename (db, folder, desiredName) {
  let candidate = desiredName
  let n = 1
  const dot = desiredName.lastIndexOf('.')
  const base = dot === -1 ? desiredName : desiredName.slice(0, dot)
  const ext = dot === -1 ? '' : desiredName.slice(dot)
  // eslint-disable-next-line no-await-in-loop -- collisions are rare; this loop runs once almost always
  while (await db.prepare('SELECT 1 FROM photos WHERE folder = ? AND filename = ?').bind(folder, candidate).first()) {
    n += 1
    candidate = `${base}-${n}${ext}`
  }
  return candidate
}

export function joinKey (folder, filename) {
  return folder ? `${folder}/${filename}` : filename
}

// Object storage has no real directories, so a folder only "exists" for the
// admin's browser/dropdowns if something registers it — otherwise a photo
// uploaded straight into "Invités/Camille" (guest uploads never call
// create-folder first) would be unreachable by navigating there. Called
// after every successful upload so the folders table stays a complete,
// single source of truth: it registers the folder itself *and* every
// ancestor, so "Invités/Camille/Sous-dossier" also makes "Invités" and
// "Invités/Camille" browsable, even if they hold no photos directly.
export async function registerFolderPath (db, folder) {
  if (!folder) return
  const segments = folder.split('/')
  const insert = db.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)')
  await db.batch(segments.map((_, i) => insert.bind(segments.slice(0, i + 1).join('/'))))
}

// A photo's tags as one comma-joined column (split back with splitTags()).
// Used by both /admin/state and /photos-list, which select from "photos p".
export const TAG_LIST_SQL =
  "COALESCE((SELECT GROUP_CONCAT(tag_name) FROM photo_tags WHERE photo_id = p.id), '') AS tagList"

export function splitTags (tagList) {
  return tagList ? tagList.split(',') : []
}

// Each photo may have a small JPEG thumbnail (made by the uploader's browser,
// see src/thumbnail.js) stored in R2 at THUMB_PREFIX + the photo's key. It has
// no D1 row; the grids ask for it and fall back to the original if missing.
// Photos can't live in a folder with this name, or keys could collide.
const THUMB_PREFIX = '_thumbs/'
const MAX_THUMB_BYTES = 300 * 1024

export function thumbKey (key) {
  return THUMB_PREFIX + key
}

export function isReservedFolder (folder) {
  return folder === '_thumbs' || folder.startsWith(THUMB_PREFIX)
}

// Stores one uploaded file in R2 + D1 under `folder` (admin and guest
// uploads alike; guestId is null for the admin's own), plus its optional
// thumbnail. Returns an error message, or null on success.
export async function storePhoto (env, folder, file, guestId = null, thumb = null) {
  if (!file.type.startsWith('image/')) return `${file.name} : type de fichier non supporté.`
  const filename = await uniqueFilename(env.DB, folder, safeFilename(file.name))
  const key = joinKey(folder, filename)
  await env.PHOTOS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
  if (thumb instanceof File && thumb.type === 'image/jpeg' && thumb.size <= MAX_THUMB_BYTES) {
    await env.PHOTOS_BUCKET.put(thumbKey(key), thumb.stream(), { httpMetadata: { contentType: 'image/jpeg' } })
  }
  await env.DB.prepare(
    'INSERT INTO photos (r2_key, folder, filename, guest_id, size_bytes) VALUES (?, ?, ?, ?, ?)'
  ).bind(key, folder, filename, guestId, file.size).run()
  return null
}

// Moves one photo row ({ id, r2_key, filename }) into `folder`, renaming
// it on collision. R2 has no rename, so it's a copy + delete.
export async function relocatePhoto (env, photo, folder) {
  const filename = await uniqueFilename(env.DB, folder, photo.filename)
  const key = joinKey(folder, filename)
  for (const [from, to] of [[photo.r2_key, key], [thumbKey(photo.r2_key), thumbKey(key)]]) {
    const object = await env.PHOTOS_BUCKET.get(from)
    if (!object) continue
    await env.PHOTOS_BUCKET.put(to, object.body, { httpMetadata: object.httpMetadata })
    await env.PHOTOS_BUCKET.delete(from)
  }
  await env.DB.prepare(
    'UPDATE photos SET r2_key = ?, folder = ?, filename = ? WHERE id = ?'
  ).bind(key, folder, filename, photo.id).run()
}

// Deletes photo rows ({ id, r2_key }) and their thumbnails from R2 and D1 in
// bulk: R2 takes up to 1000 keys per delete() call (2 per photo here), and
// the D1 deletes go in one batch.
export async function deletePhotoRows (env, photos) {
  for (let i = 0; i < photos.length; i += 500) {
    const chunk = photos.slice(i, i + 500)
    await env.PHOTOS_BUCKET.delete(chunk.flatMap((p) => [p.r2_key, thumbKey(p.r2_key)]))
    const del = env.DB.prepare('DELETE FROM photos WHERE id = ?')
    await env.DB.batch(chunk.map((p) => del.bind(p.id)))
  }
}
