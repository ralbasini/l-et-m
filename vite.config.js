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
        main: r('src/index.html'),
        slideshow: r('src/slideshow/index.html'),
        admin: r('src/admin/index.html'),
        photos: r('src/photos/index.html'),
        // Redirect-only stub: this page used to live at /guest/ (see
        // src/guest/index.html) — kept as a thin forward to /photos/ so an
        // already-shared URL/QR code doesn't just start 404ing.
        guest: r('src/guest/index.html'),
      },
    },
  },
})
