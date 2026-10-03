import { json } from '../cors.js'
import { signToken } from '../auth.js'
import { registerFolderPath, TAG_LIST_SQL, splitTags, storePhoto, relocatePhoto, deletePhotoRows } from '../files.js'

// Every handler here except login/logout is wrapped in adminOnly() by the
// route table in index.js.

// The admin password is short and shared, so guessing is throttled per IP:
// MAX_LOGIN_FAILURES wrong tries lock that IP out for LOGIN_LOCK_MS.
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000

async function sha256 (text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
}

// Hashing first gives both sides the same length, which timingSafeEqual
// requires, without leaking the real password's length.
async function passwordMatches (given, expected) {
  if (!given || !expected) return false
  return crypto.subtle.timingSafeEqual(await sha256(given), await sha256(expected))
}

export async function login (request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const now = Date.now()
  const attempts = await env.DB.prepare(
    'SELECT failures, locked_until FROM login_attempts WHERE ip = ?'
  ).bind(ip).first()

  if (attempts && attempts.locked_until > now) {
    const minutes = Math.ceil((attempts.locked_until - now) / 60000)
    return json({ error: `Trop de tentatives. Réessayez dans ${minutes} min.` }, { status: 429 })
  }

  const { password } = await request.json().catch(() => ({}))
  if (!(await passwordMatches(password, env.ADMIN_PASSWORD))) {
    // A lock that has expired starts a fresh count.
    const previous = attempts && attempts.locked_until === 0 ? attempts.failures : 0
    const failures = previous + 1
    const lockedUntil = failures >= MAX_LOGIN_FAILURES ? now + LOGIN_LOCK_MS : 0
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, failures, locked_until) VALUES (?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`
    ).bind(ip, lockedUntil ? 0 : failures, lockedUntil).run()
    return json({ error: 'Mot de passe incorrect.' }, { status: 401 })
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
  const token = await signToken(env.ADMIN_TOKEN_SECRET, { role: 'admin' })
  return json({ token })
}

// Tokens are stateless (HMAC-verified on every request, nothing stored
// server-side), so there's nothing to revoke here — this only exists so the
// client has a symmetric call to make before it clears its own local token.
export async function logout () {
  return json({ ok: true })
}

function formatGb (bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`
}

function normalizePath (raw) {
  return (raw || '').replace(/^\/+|\/+$/g, '')
}

export async function state (request, env) {
  const url = new URL(request.url)
  const path = normalizePath(url.searchParams.get('path'))

  // No folder selected (the top level): every photo, from all folders —
  // each one's folder is shown on its card. Inside a folder: just its own.
  const photoQuery = `SELECT p.r2_key, p.filename, p.folder, ${TAG_LIST_SQL} FROM photos p`
  const [{ results: folderRows }, { results: photoRows }, { results: tagRows }, { results: [totalRow] }] = await env.DB.batch([
    env.DB.prepare('SELECT path FROM folders ORDER BY path'),
    path === ''
      ? env.DB.prepare(`${photoQuery} ORDER BY p.folder, p.filename`)
      : env.DB.prepare(`${photoQuery} WHERE p.folder = ? ORDER BY p.filename`).bind(path),
    env.DB.prepare('SELECT name FROM tags ORDER BY name'),
    env.DB.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM photos'),
  ])
  const allFolders = folderRows.map((r) => r.path)

  // Direct children only: folders whose path is exactly one segment deeper
  // than the current one.
  const folders = allFolders
    .filter((f) => (path === '' ? !f.includes('/') : f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes('/')))
    .map((f) => (path === '' ? f : f.slice(path.length + 1)))

  const photos = photoRows.map((p) => ({
    path: p.r2_key,
    filename: p.filename,
    folder: p.folder,
    tags: splitTags(p.tagList),
  }))

  const usedBytes = totalRow.total
  // R2 has no hard storage quota — this is a soft, purely informational
  // reference point for the dashboard's usage bar, not an enforced limit.
  const maxBytes = Number(env.STORAGE_SOFT_LIMIT_GB || 20) * 1024 ** 3

  return json({
    path,
    breadcrumb: path ? path.split('/') : [],
    folders,
    allFolders,
    photos,
    registry: tagRows.map((t) => t.name),
    storage: {
      usedLabel: formatGb(usedBytes),
      maxLabel: formatGb(maxBytes),
      usedPercent: Math.min(100, (usedBytes / maxBytes) * 100),
    },
  })
}

// Admin uploads go directly into whatever folder the "path" form field
// names (the <select id="upload-dest"> in admin/index.html), with no
// per-guest quota — unlike guest uploads, which are always scoped to that
// guest's own folder.
export async function upload (request, env) {
  const formData = await request.formData()
  const rawPath = (formData.get('path') || '.').toString()
  const folder = rawPath === '.' ? '' : normalizePath(rawPath)
  // Photos always go into a folder, never loose at the top level.
  if (!folder) return json({ error: 'Choisissez un dossier de destination.' }, { status: 400 })
  const files = formData.getAll('photos[]').filter((f) => f instanceof File)
  await registerFolderPath(env.DB, folder)
  const errors = []
  let uploaded = 0

  for (const file of files) {
    const error = await storePhoto(env, folder, file)
    if (error) errors.push(error)
    else uploaded += 1
  }

  return json({ uploaded, errors })
}

export async function createFolder (request, env) {
  const { path, name } = await request.json().catch(() => ({}))
  const base = normalizePath(path)
  const safeName = (name || '').trim().replace(/[\\/]+/g, '-')
  if (!safeName) return json({ error: 'Nom de dossier invalide.' }, { status: 400 })

  const fullPath = base ? `${base}/${safeName}` : safeName
  await env.DB.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)').bind(fullPath).run()
  return json({ path: fullPath })
}

export async function deleteFolder (request, env) {
  const { folders, mode } = await request.json().catch(() => ({}))
  let deleted = 0

  for (const folderPath of folders || []) {
    if (mode === 'purge') {
      // This folder and everything nested under it ('/' is the hierarchy
      // separator in folder paths, same as R2 keys).
      const { results: photos } = await env.DB.prepare(
        'SELECT id, r2_key FROM photos WHERE folder = ? OR folder LIKE ?'
      ).bind(folderPath, `${folderPath}/%`).all()
      await deletePhotoRows(env, photos)
    } else {
      // keep_photos: only this folder's own photos move up to its parent.
      // Nested subfolders (and their photos) are left exactly where they
      // are — matching the admin UI's own wording for this mode.
      const parent = folderPath.includes('/') ? folderPath.slice(0, folderPath.lastIndexOf('/')) : ''
      const { results: photos } = await env.DB.prepare(
        'SELECT id, r2_key, filename FROM photos WHERE folder = ?'
      ).bind(folderPath).all()

      for (const photo of photos) await relocatePhoto(env, photo, parent)
    }

    await env.DB.prepare('DELETE FROM folders WHERE path = ? OR path LIKE ?').bind(folderPath, `${folderPath}/%`).run()
    deleted += 1
  }

  return json({ deleted, skipped: 0 })
}

export async function addTag (request, env) {
  const { name } = await request.json().catch(() => ({}))
  const clean = (name || '').trim()
  if (!clean) return json({ error: 'Nom de tag invalide.' }, { status: 400 })

  await env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(clean).run()
  return json({ ok: true })
}

export async function deleteTag (request, env) {
  const { name } = await request.json().catch(() => ({}))
  await env.DB.prepare('DELETE FROM photo_tags WHERE tag_name = ?').bind(name).run()
  await env.DB.prepare('DELETE FROM tags WHERE name = ?').bind(name).run()
  return json({ ok: true })
}

export async function deletePhotos (request, env) {
  const { files = [] } = await request.json().catch(() => ({}))
  const photos = await findPhotos(env, files)
  await deletePhotoRows(env, photos)
  return json({ deleted: photos.length, skipped: files.length - photos.length })
}

export async function movePhotos (request, env) {
  const { files = [], dest } = await request.json().catch(() => ({}))
  const folder = dest === '.' ? '' : normalizePath(dest)
  if (folder) await registerFolderPath(env.DB, folder)
  const photos = await findPhotos(env, files)
  for (const photo of photos) await relocatePhoto(env, photo, folder)
  return json({ moved: photos.length, skipped: files.length - photos.length })
}

export async function tagPhotos (request, env) {
  const { updates = [] } = await request.json().catch(() => ({}))
  const photos = await findPhotos(env, updates.map((u) => u.path))
  const idByKey = new Map(photos.map((p) => [p.r2_key, p.id]))
  const clear = env.DB.prepare('DELETE FROM photo_tags WHERE photo_id = ?')
  const add = env.DB.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_name) VALUES (?, ?)')
  const statements = []
  let updated = 0

  for (const { path, tags } of updates) {
    const id = idByKey.get(path)
    if (id === undefined) continue
    statements.push(clear.bind(id), ...(tags || []).map((tag) => add.bind(id, tag)))
    updated += 1
  }
  if (statements.length) await env.DB.batch(statements)

  return json({ updated })
}

// The rows for a list of photo paths (r2_keys); paths that don't exist are
// just absent from the result. One query per 100 paths (D1's cap on bound
// parameters per query).
async function findPhotos (env, paths) {
  const rows = []
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    const { results } = await env.DB.prepare(
      `SELECT id, r2_key, filename FROM photos WHERE r2_key IN (${chunk.map(() => '?').join(', ')})`
    ).bind(...chunk).all()
    rows.push(...results)
  }
  return rows
}
