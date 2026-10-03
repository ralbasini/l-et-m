// Backend: the Cloudflare Worker in cloudflare/. Photos live in R2 and are served by that same Worker under
// /img/ — see cloudflare/README.md and cloudflare/src/routes/img.js.
export const API_BASE_URL = 'https://l-et-m-api.romain-albasini.workers.dev/'
export const PHOTOS_BASE_URL = API_BASE_URL + 'img/'

// URL of a stored photo, from its path in the bucket (e.g.
// "Invités/Camille/photo.jpg"). Each segment is encoded separately so the
// '/' itself isn't escaped.
export function photoUrl (path) {
  return PHOTOS_BASE_URL + path.split('/').map(encodeURIComponent).join('/')
}

// ── Photo source ────────────────────────────────────────────────
// No manifest, no images committed to the repo: this asks the Worker's
// /photos-list what's currently in the bucket. Upload a photo and it shows
// up on next load — nothing to redeploy. Shared by the gallery
// (src/galerie/main.js) and the projector slideshow (src/diaporama/main.js).
export async function loadPhotos () {
  try {
    const res = await fetch(API_BASE_URL + 'photos-list', { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    // `by` is who uploaded it (guest name), '' for the admin's own uploads.
    return data.map(({ file, alt, tags = [], by = '' }) => ({
      src: photoUrl(file),
      alt: alt || 'Photo du mariage de Lobna et Martin',
      tags,
      by,
    }))
  } catch {
    return []
  }
}
