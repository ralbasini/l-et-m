import { corsHeaders } from '../cors.js'

// Public, no auth — serves photos straight out of R2 at /img/<r2_key>, so
// PHOTOS_BASE_URL on the main site is just this Worker's URL + 'img/'.
// Chosen over the bucket's r2.dev URL (rate-limited, not meant for
// production — risky with a projector slideshow and a room full of phones
// hitting it at once).
const PREFIX = '/img/'

export function isImgPath (pathname) {
  return pathname.startsWith(PREFIX)
}

export async function serveImg (request, env) {
  const url = new URL(request.url)
  let key
  try {
    // The frontend encodes each path segment separately (see loadPhotos()
    // in src/photos.js), so decoding the whole thing restores the key.
    key = decodeURIComponent(url.pathname.slice(PREFIX.length))
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (!key) return new Response('Not found', { status: 404 })

  const object = await env.PHOTOS_BUCKET.get(key, {
    onlyIf: request.headers,
    range: request.headers,
  })
  if (!object) return new Response('Not found', { status: 404 })

  const headers = new Headers(corsHeaders())
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  // A photo at a given key never changes in place (a move or re-upload gets
  // a new key), but it can be deleted — an hour keeps deletes taking effect
  // reasonably quickly while still letting browsers skip re-downloading
  // during a slideshow loop.
  headers.set('Cache-Control', 'public, max-age=3600')
  // The stored Content-Type is whatever the uploader's browser claimed
  // (only checked to start with "image/"), so an uploaded SVG could carry
  // script. Sandboxing + nosniff means opening one directly can't run
  // anything on this origin.
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  headers.set('X-Content-Type-Options', 'nosniff')

  // onlyIf failed (e.g. If-None-Match matched): R2 returns metadata with no body.
  if (!('body' in object)) return new Response(null, { status: 304, headers })

  if (request.headers.has('range') && object.range) {
    const { offset = 0, length = object.size - offset } = object.range
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers })
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}
