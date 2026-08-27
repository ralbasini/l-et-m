// Photos are hosted outside this repo, in an Infomaniak folder that also
// holds infomaniak/photos-list.php (see that file). It sends its own CORS
// header, so the same URL works from both `npm run dev` and production.
export const REMOTE_GALLERY_URL = 'https://ralbasini.ch/l-et-m/'

// ── Photo source ────────────────────────────────────────────────
// No manifest, no images committed to the repo: this asks photos-list.php
// what's currently in the Infomaniak folder. Drop a photo in that folder
// and it shows up on next load — nothing to redeploy. Shared by the main
// site (src/main.js) and the projector slideshow (src/slideshow/main.js).
export async function loadPhotos () {
  try {
    const res = await fetch(REMOTE_GALLERY_URL + 'photos-list.php', { cache: 'no-store' })
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
        src: REMOTE_GALLERY_URL + 'img/' + encodedPath,
        alt: alt || 'Photo du mariage de Lobna et Martin',
        tags,
      }
    })
  } catch {
    return []
  }
}
