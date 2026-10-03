// Mirrors safeUploadFilename()/uniqueTargetName() from the old PHP backend
// (see the "serverNamePattern" comment in src/photos/main.js on the main
// site, which pattern-matches against exactly this sanitization): the
// basename gets non [a-zA-Z0-9_-] characters replaced with '-', and the
// extension is lowercased.
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
  for (let i = 1; i <= segments.length; i++) {
    const ancestor = segments.slice(0, i).join('/')
    // eslint-disable-next-line no-await-in-loop -- at most a handful of segments, and this only runs on upload
    await db.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)').bind(ancestor).run()
  }
}
