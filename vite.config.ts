import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    include: ['tengwar/general-use.js', 'tengwar/tengwar-annatar.js', 'opentype.js'],
  },
  build: {
    commonjsOptions: {
      include: [/tengwar/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
