import { json } from '../cors.js'

// Public, no auth — replaces photos-list.php. Feeds loadPhotos() (shared by
// the main gallery and the projector slideshow) via the main site's
// src/photos.js, so the response shape here must keep matching what that
// function expects: an array of { file, alt, tags }.
export async function photosList (env) {
  const { results } = await env.DB.prepare(`
    SELECT p.r2_key AS file, p.caption AS alt,
           COALESCE((
             SELECT GROUP_CONCAT(tag_name) FROM photo_tags WHERE photo_id = p.id
           ), '') AS tagList
    FROM photos p
    ORDER BY p.r2_key
  `).all()

  const photos = results.map((row) => ({
    file: row.file,
    alt: row.alt || '',
    tags: row.tagList ? row.tagList.split(',') : [],
  }))
  return json(photos)
}
