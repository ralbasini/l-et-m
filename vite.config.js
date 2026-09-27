import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: 'src',
  base: '/l-et-m/',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Root = the site-home "wedding info" page — the default page.
        main: r('src/index.html'),
        galerie: r('src/galerie/index.html'),
        slideshow: r('src/slideshow/index.html'),
        admin: r('src/admin/index.html'),
        photos: r('src/photos/index.html'),
        // Redirect-only stubs, kept as thin forwards so an already-shared
        // URL/QR code doesn't just start 404ing after a page moved:
        // /guest -> /photos, /mariage -> / (root).
        guest: r('src/guest/index.html'),
        mariage: r('src/mariage/index.html'),
      },
    },
  },
})
