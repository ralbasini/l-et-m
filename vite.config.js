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
        slideshow2: r('src/slideshow-2/index.html'),
      },
    },
  },
})
