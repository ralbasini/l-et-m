import { json } from '../cors.js'
import { TAG_LIST_SQL, splitTags } from '../files.js'

// Public, no auth. Feeds loadPhotos() in src/photos.js (shared by the
// gallery and the projector slideshow), so the response shape here must keep
// matching what that function expects: an array of { file, alt, tags, by }.
export async function photosList (request, env) {
  const { results } = await env.DB.prepare(`
    SELECT p.r2_key AS file, p.caption AS alt, g.name AS uploader,
           ${TAG_LIST_SQL}
    FROM photos p
    LEFT JOIN guests g ON g.id = p.guest_id
    ORDER BY p.r2_key
  `).all()

  const photos = results.map((row) => ({
    file: row.file,
    alt: row.alt || '',
    tags: splitTags(row.tagList),
    // Name of the guest who uploaded it (shown under the photo in the
    // gallery); empty for photos the admin uploaded.
    by: row.uploader || '',
  }))
  return json(photos)
}
