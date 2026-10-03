import { handleOptions, json } from './cors.js'
import { photosList } from './routes/photosList.js'
import * as guest from './routes/guest.js'
import * as admin from './routes/admin.js'
import { isImgPath, serveImg } from './routes/img.js'

// One route table for the whole API. Paths intentionally mirror the old PHP
// endpoints minus the ".php" (identify.php -> /guest/identify, etc.) so the
// migration on the frontend side is close to a find-and-replace — see
// src/photos.js, src/photos/main.js and src/admin/main.js on the main site.
const routes = {
  'GET /photos-list': (request, env) => photosList(env),

  'POST /guest/identify': guest.identify,
  'GET /guest/me': guest.me,
  'POST /guest/upload': guest.upload,
  'POST /guest/delete': guest.deletePhoto,

  'POST /admin/login': admin.login,
  'POST /admin/logout': admin.logout,
  'GET /admin/state': admin.state,
  'POST /admin/upload': admin.upload,
  'POST /admin/create-folder': admin.createFolder,
  'POST /admin/delete-folder': admin.deleteFolder,
  'POST /admin/add-tag': admin.addTag,
  'POST /admin/delete-tag': admin.deleteTag,
  'POST /admin/delete': admin.deletePhotos,
  'POST /admin/move': admin.movePhotos,
  'POST /admin/tag': admin.tagPhotos,
}

export default {
  async fetch (request, env) {
    if (request.method === 'OPTIONS') return handleOptions()

    const url = new URL(request.url)
    if ((request.method === 'GET' || request.method === 'HEAD') && isImgPath(url.pathname)) {
      return serveImg(request, env)
    }
    const handler = routes[`${request.method} ${url.pathname}`]
    if (!handler) return json({ error: 'Not found' }, { status: 404 })

    try {
      return await handler(request, env)
    } catch (err) {
      // A stack trace leaking into a public response is an acceptable
      // trade-off for a small project you're the only one debugging — but
      // tighten this (log to Workers Logs instead) before handing this URL
      // out beyond yourselves.
      return json({ error: 'Erreur serveur.', detail: String(err) }, { status: 500 })
    }
  },
}
