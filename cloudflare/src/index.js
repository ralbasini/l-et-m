import { handleOptions, json } from './cors.js'
import { photosList } from './routes/photosList.js'
import * as guest from './routes/guest.js'
import * as admin from './routes/admin.js'
import { adminOnly, guestOnly } from './auth.js'
import { isImgPath, serveImg } from './routes/img.js'
import { getSettings, updateSettings } from './routes/settings.js'

// One route table for the whole API. /admin/* routes (except login/logout)
// are wrapped in adminOnly(), /guest/* ones (except identify) in guestOnly()
// — the check lives here, not in each handler.
const routes = {
  'GET /photos-list': photosList,
  'GET /settings': getSettings,

  'POST /guest/identify': guest.identify,
  'GET /guest/me': guestOnly(guest.me),
  'POST /guest/upload': guestOnly(guest.upload),
  'POST /guest/delete': guestOnly(guest.deletePhoto),

  'POST /admin/login': admin.login,
  'POST /admin/logout': admin.logout,
  'GET /admin/state': adminOnly(admin.state),
  'POST /admin/upload': adminOnly(admin.upload),
  'POST /admin/create-folder': adminOnly(admin.createFolder),
  'POST /admin/delete-folder': adminOnly(admin.deleteFolder),
  'POST /admin/add-tag': adminOnly(admin.addTag),
  'POST /admin/delete-tag': adminOnly(admin.deleteTag),
  'POST /admin/delete': adminOnly(admin.deletePhotos),
  'POST /admin/move': adminOnly(admin.movePhotos),
  'POST /admin/tag': adminOnly(admin.tagPhotos),
  'POST /admin/settings': adminOnly(updateSettings),
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
