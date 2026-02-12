import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    open: '/login.html'
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        login: 'login.html'
      }
    }
  }
})
