import { json } from '../cors.js'
import { signToken, verifyToken, getBearerToken } from '../auth.js'
import { safeFilename, uniqueFilename, joinKey, registerFolderPath } from '../files.js'

async function requireAdmin (request, env) {
  const token = getBearerToken(request)
  const payload = await verifyToken(env.ADMIN_TOKEN_SECRET, token)
  return Boolean(payload && payload.role === 'admin')
}

function unauthorized () {
  return json({ error: 'Non autorisé.' }, { status: 401 })
}

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
  if (!(await requireAdmin(request, env))) return unauthorized()

  const url = new URL(request.url)
  const path = normalizePath(url.searchParams.get('path'))

  const { results: folderRows } = await env.DB.prepare('SELECT path FROM folders ORDER BY path').all()
  const allFolders = folderRows.map((r) => r.path)

  // Direct children only: folders whose path is exactly one segment deeper
  // than the current one.
  const folders = allFolders
    .filter((f) => (path === '' ? !f.includes('/') : f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes('/')))
    .map((f) => (path === '' ? f : f.slice(path.length + 1)))

  const { results: photoRows } = await env.DB.prepare(`
    SELECT p.r2_key, p.filename, p.folder,
           COALESCE((SELECT GROUP_CONCAT(tag_name) FROM photo_tags WHERE photo_id = p.id), '') AS tagList
    FROM photos p WHERE p.folder = ? ORDER BY p.filename
  `).bind(path).all()

  const photos = photoRows.map((p) => ({
    path: p.r2_key,
    filename: p.filename,
    folder: p.folder,
    tags: p.tagList ? p.tagList.split(',') : [],
  }))

  const { results: tagRows } = await env.DB.prepare('SELECT name FROM tags ORDER BY name').all()

  const totalRow = await env.DB.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM photos').first()
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
  if (!(await requireAdmin(request, env))) return unauthorized()

  const formData = await request.formData()
  const rawPath = (formData.get('path') || '.').toString()
  const folder = rawPath === '.' ? '' : normalizePath(rawPath)
  const files = formData.getAll('photos[]').filter((f) => f instanceof File)
  if (folder) await registerFolderPath(env.DB, folder)
  const errors = []
  let uploaded = 0

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      errors.push(`${file.name} : type de fichier non supporté.`)
      continue
    }
    const filename = await uniqueFilename(env.DB, folder, safeFilename(file.name))
    const key = joinKey(folder, filename)
    await env.PHOTOS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
    await env.DB.prepare(
      'INSERT INTO photos (r2_key, folder, filename, size_bytes) VALUES (?, ?, ?, ?)'
    ).bind(key, folder, filename, file.size).run()
    uploaded += 1
  }

  return json({ uploaded, errors })
}

export async function createFolder (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { path, name } = await request.json().catch(() => ({}))
  const base = normalizePath(path)
  const safeName = (name || '').trim().replace(/[\\/]+/g, '-')
  if (!safeName) return json({ error: 'Nom de dossier invalide.' }, { status: 400 })

  const fullPath = base ? `${base}/${safeName}` : safeName
  await env.DB.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)').bind(fullPath).run()
  return json({ path: fullPath })
}

// This folder and every folder nested under it (folders.path uses '/' as
// the hierarchy separator, same as R2 keys).
async function collectSubfolderPaths (env, path) {
  const { results } = await env.DB.prepare(
    'SELECT path FROM folders WHERE path = ? OR path LIKE ?'
  ).bind(path, `${path}/%`).all()
  return results.map((r) => r.path)
}

export async function deleteFolder (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { folders, mode } = await request.json().catch(() => ({}))
  let deleted = 0
  const skipped = 0

  for (const folderPath of folders || []) {
    if (mode === 'purge') {
      const subfolders = await collectSubfolderPaths(env, folderPath)
      for (const sub of subfolders) {
        const { results: photos } = await env.DB.prepare('SELECT r2_key FROM photos WHERE folder = ?').bind(sub).all()
        for (const photo of photos) {
          await env.PHOTOS_BUCKET.delete(photo.r2_key)
        }
        await env.DB.prepare('DELETE FROM photos WHERE folder = ?').bind(sub).run()
      }
    } else {
      // keep_photos: only this folder's own photos move up to its parent.
      // Nested subfolders (and their photos) are left exactly where they
      // are — matching the admin UI's own wording for this mode.
      const parent = folderPath.includes('/') ? folderPath.slice(0, folderPath.lastIndexOf('/')) : ''
      const { results: photos } = await env.DB.prepare(
        'SELECT id, r2_key, filename FROM photos WHERE folder = ?'
      ).bind(folderPath).all()

      for (const photo of photos) {
        const newFilename = await uniqueFilename(env.DB, parent, photo.filename)
        const newKey = joinKey(parent, newFilename)
        const object = await env.PHOTOS_BUCKET.get(photo.r2_key)
        if (object) {
          await env.PHOTOS_BUCKET.put(newKey, object.body, { httpMetadata: object.httpMetadata })
          await env.PHOTOS_BUCKET.delete(photo.r2_key)
        }
        await env.DB.prepare(
          'UPDATE photos SET r2_key = ?, folder = ?, filename = ? WHERE id = ?'
        ).bind(newKey, parent, newFilename, photo.id).run()
      }
    }

    await env.DB.prepare('DELETE FROM folders WHERE path = ? OR path LIKE ?').bind(folderPath, `${folderPath}/%`).run()
    deleted += 1
  }

  return json({ deleted, skipped })
}

export async function addTag (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { name } = await request.json().catch(() => ({}))
  const clean = (name || '').trim()
  if (!clean) return json({ error: 'Nom de tag invalide.' }, { status: 400 })

  await env.DB.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(clean).run()
  return json({ ok: true })
}

export async function deleteTag (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { name } = await request.json().catch(() => ({}))
  await env.DB.prepare('DELETE FROM photo_tags WHERE tag_name = ?').bind(name).run()
  await env.DB.prepare('DELETE FROM tags WHERE name = ?').bind(name).run()
  return json({ ok: true })
}

export async function deletePhotos (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { files } = await request.json().catch(() => ({}))
  let deleted = 0
  let skipped = 0

  for (const path of files || []) {
    const row = await env.DB.prepare('SELECT id, r2_key FROM photos WHERE r2_key = ?').bind(path).first()
    if (!row) { skipped += 1; continue }
    await env.PHOTOS_BUCKET.delete(row.r2_key)
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(row.id).run()
    deleted += 1
  }

  return json({ deleted, skipped })
}

export async function movePhotos (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { files, dest } = await request.json().catch(() => ({}))
  const folder = dest === '.' ? '' : normalizePath(dest)
  if (folder) await registerFolderPath(env.DB, folder)
  let moved = 0
  let skipped = 0

  for (const path of files || []) {
    const row = await env.DB.prepare('SELECT id, r2_key, filename FROM photos WHERE r2_key = ?').bind(path).first()
    if (!row) { skipped += 1; continue }

    const newFilename = await uniqueFilename(env.DB, folder, row.filename)
    const newKey = joinKey(folder, newFilename)
    const object = await env.PHOTOS_BUCKET.get(row.r2_key)
    if (object) {
      await env.PHOTOS_BUCKET.put(newKey, object.body, { httpMetadata: object.httpMetadata })
      await env.PHOTOS_BUCKET.delete(row.r2_key)
    }
    await env.DB.prepare(
      'UPDATE photos SET r2_key = ?, folder = ?, filename = ? WHERE id = ?'
    ).bind(newKey, folder, newFilename, row.id).run()
    moved += 1
  }

  return json({ moved, skipped })
}

export async function tagPhotos (request, env) {
  if (!(await requireAdmin(request, env))) return unauthorized()

  const { updates } = await request.json().catch(() => ({}))
  let updated = 0

  for (const { path, tags } of updates || []) {
    const row = await env.DB.prepare('SELECT id FROM photos WHERE r2_key = ?').bind(path).first()
    if (!row) continue
    await env.DB.prepare('DELETE FROM photo_tags WHERE photo_id = ?').bind(row.id).run()
    for (const tag of tags || []) {
      await env.DB.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_name) VALUES (?, ?)').bind(row.id, tag).run()
    }
    updated += 1
  }

  return json({ updated })
}
