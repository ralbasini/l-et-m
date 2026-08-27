import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  base: '/l-et-m/',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
