// Backend: the Cloudflare Worker in cloudflare/ (replaces the old Infomaniak
// PHP scripts). Photos live in R2 and are served by that same Worker under
// /img/ — see cloudflare/README.md and cloudflare/src/routes/img.js.
export const API_BASE_URL = 'https://l-et-m-api.romain-albasini.workers.dev/'
export const PHOTOS_BASE_URL = API_BASE_URL + 'img/'

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
