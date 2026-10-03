import { json } from '../cors.js'

// Public, no auth — replaces photos-list.php. Feeds loadPhotos() (shared by
// the main gallery and the projector slideshow) via the main site's
// src/photos.js, so the response shape here must keep matching what that
// function expects: an array of { file, alt, tags }.
export async function photosList (env) {
  const { results } = await env.DB.prepare(`
    SELECT p.r2_key AS file, p.caption AS alt, g.name AS uploader,
           COALESCE((
             SELECT GROUP_CONCAT(tag_name) FROM photo_tags WHERE photo_id = p.id
           ), '') AS tagList
    FROM photos p
    LEFT JOIN guests g ON g.id = p.guest_id
    ORDER BY p.r2_key
  `).all()

  const photos = results.map((row) => ({
    file: row.file,
    alt: row.alt || '',
    tags: row.tagList ? row.tagList.split(',') : [],
    // Name of the guest who uploaded it (shown under the photo in the
    // gallery); empty for photos the admin uploaded.
    by: row.uploader || '',
  }))
  return json(photos)
}
