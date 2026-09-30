// The frontend is served from a different origin (GitHub Pages, or whatever
// custom domain the main site ends up on) than this Worker, so every
// response needs CORS headers — the PHP backend did the same (see the "it
// sends its own CORS header" comment in src/photos.js on the main site).
//
// TODO: once the site's final public domain is settled, replace '*' with
// that exact origin (e.g. 'https://ralbasini.github.io') to stop lock the
// API down to only your own frontend.
const ALLOWED_ORIGIN = '*'

export function corsHeaders () {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }
}

export function json (data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...(init.headers || {}) },
  })
}

export function handleOptions () {
  return new Response(null, { headers: corsHeaders() })
}
