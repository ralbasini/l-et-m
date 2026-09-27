import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))
const base = '/l-et-m/'

function redirectBarePhotosPath (request, response, next) {
  const pathname = new URL(request.url || '/', 'http://vite.local').pathname
  if (pathname !== `${base}photos`.replace(/\/$/, '')) return next()

  response.statusCode = 302
  response.setHeader('Location', `${base}#photos`)
  response.end()
}

export default defineConfig({
  root: 'src',
  base,
  plugins: [{
    name: 'bare-photos-route-redirect',
    configureServer (server) {
      server.middlewares.use(redirectBarePhotosPath)
    },
    configurePreviewServer (server) {
      server.middlewares.use(redirectBarePhotosPath)
    },
  }],
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Root = the site-home "wedding info" page — the default page.
        main: r('src/index.html'),
        galerie: r('src/galerie/index.html'),
        diaporama: r('src/diaporama/index.html'),
        slideshow: r('src/slideshow/index.html'),
        admin: r('src/admin/index.html'),
        photos: r('src/photos/index.html'),
        // Redirect-only stubs, kept as thin forwards so an already-shared
        // URL/QR code doesn't just start 404ing after a page moved:
        // /guest -> /photos, /mariage -> / (root), /slideshow -> /diaporama.
        guest: r('src/guest/index.html'),
        mariage: r('src/mariage/index.html'),
      },
    },
  },
})
