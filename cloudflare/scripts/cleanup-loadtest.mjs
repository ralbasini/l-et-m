// Removes the load-test data: every photo of the fake guests "Lamaya 01".."Lamaya 99"
// (photos + thumbnails, through the normal guest API — no admin needed).
// Run:  node cloudflare/scripts/cleanup-loadtest.mjs
// Leftovers (empty folders + guest rows) are listed at the end with the one SQL line to remove them.
const API = 'https://l-et-m-api.romain-albasini.workers.dev/'
const post = (path, body, token) => fetch(API + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body),
}).then((r) => r.json())

let deleted = 0
for (let n = 1; n <= 99; n++) {
  const name = `Lamaya ${String(n).padStart(2, '0')}`
  let id = await post('guest/identify', { name })
  if (id.status === 'collision') id = await post('guest/identify', { confirm_name: name })
  if (!id.token) { console.log(`${name}: skipped`); continue }
  const me = await fetch(API + 'guest/me', { headers: { Authorization: 'Bearer ' + id.token } }).then((r) => r.json())
  if (!me.photos.length && n > 40) break // past the last test guest
  for (let i = 0; i < me.photos.length; i += 5) {
    await Promise.all(me.photos.slice(i, i + 5).map((file) => post('guest/delete', { file }, id.token)))
    deleted += Math.min(5, me.photos.length - i)
  }
  console.log(`${name}: ${me.photos.length} photo(s) deleted`)
}
console.log(`\nDone: ${deleted} photos deleted.`)
console.log("Optional last step (removes the empty folders/guest rows), from the cloudflare/ folder:")
console.log(`npx wrangler d1 execute lobna-et-martin --remote --command "DELETE FROM guests WHERE name LIKE 'Lamaya %'; DELETE FROM folders WHERE path LIKE 'Invités/Lamaya %'"`)
