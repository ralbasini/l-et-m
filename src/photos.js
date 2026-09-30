// Photos used to be hosted on Infomaniak (PHP backend + a plain img/
// folder). Migrated to Cloudflare: the Worker in cloudflare/ replaces the
// PHP scripts, and an R2 bucket replaces img/ — see cloudflare/README.md
// for how to stand both up. Both URLs below are placeholders until that's
// done; the site falls back to an empty gallery ("photos à venir") rather
// than erroring, same as it always did while no photos exist yet.
//
// TODO: replace both once your Worker is deployed and your R2 bucket has a
// public domain attached (cloudflare/README.md walks through both).
export const API_BASE_URL = 'https://TODO-your-worker.example.workers.dev/'
export const PHOTOS_BASE_URL = 'https://TODO-your-r2-public-domain.example/'

// ── Photo source ────────────────────────────────────────────────
// No manifest, no images committed to the repo: this asks the Worker's
// /photos-list what's currently in the bucket. Upload a photo and it shows
// up on next load — nothing to redeploy. Shared by the main site
// (src/main.js) and the projector slideshow (src/diaporama/main.js).
export async function loadPhotos () {
  try {
    const res = await fetch(API_BASE_URL + 'photos-list', { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((entry) => {
      const file = typeof entry === 'string' ? entry : entry.file
      const alt = typeof entry === 'string' ? '' : (entry.alt || '')
      const tags = typeof entry === 'string' ? [] : (entry.tags || [])
      // file may include folder segments (e.g. "ceremonie/photo.jpg') — encode
      // each segment separately so the '/' itself isn't escaped.
      const encodedPath = file.split('/').map(encodeURIComponent).join('/')
      return {
        src: PHOTOS_BASE_URL + encodedPath,
        alt: alt || 'Photo du mariage de Lobna et Martin',
        tags,
      }
    })
  } catch {
    return []
  }
}
