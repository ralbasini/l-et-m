import { json } from '../cors.js'
import { TAG_LIST_SQL, splitTags } from '../files.js'

// Public, no auth. Feeds loadPhotos() in src/photos.js (shared by the
// gallery and the projector slideshow), so the response shape here must keep
// matching what that function expects: an array of { file, alt, tags, by }.
//
// Every gallery view and every projector poll lands here, and each call is a
// full D1 scan, so the response is cached (per Cloudflare location, not
// shared across them) for CACHE_SECONDS — new photos show up within that.
const CACHE_SECONDS = 10

function cacheKeyFor (request) {
  return new Request(new URL('/photos-list', request.url))
}

// Called after every write (upload, delete, move, tag…), so the list a
// visitor opens next is never the stale cached one.
export async function purgePhotosList (request) {
  await caches.default.delete(cacheKeyFor(request))
}

export async function photosList (request, env) {
  const cache = caches.default
  const cacheKey = cacheKeyFor(request)
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const response = await listPhotos(env)
  await cache.put(cacheKey, response.clone())
  return response
}

async function listPhotos (env) {
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
  return json(photos, { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } })
}
