import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Split large third-party libraries into their own chunks so the entry bundle
// stays small and vendor code can be cached across deploys. Without this the
// whole app (monaco-editor alone is ~2MB) is emitted as a single chunk, which
// trips Vite's "chunks are larger than 500 kB" warning on every Vercel build.
function manualChunks(id: string) {
  if (!id.includes('node_modules')) return
  if (id.includes('monaco-editor')) return 'monaco'
  if (id.includes('@monaco-editor')) return 'monaco-react'
  if (id.includes('y-websocket') || id.includes('y-monaco') || id.includes('/yjs/') || id.includes('/lib0/') || id.includes('/y-protocols/')) return 'collab'
  if (id.includes('/react/') || id.includes('react-dom') || id.includes('scheduler')) return 'react'
  return 'vendor'
}

export default defineConfig({
  plugins: [react()],
  build: {
    // The monaco-editor core cannot be meaningfully shrunk or lazily split
    // (y-monaco needs it eagerly), so allow that single known-large chunk
    // instead of failing the build log with a warning on every deploy.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks },
    },
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000', '/ws': { target: 'ws://localhost:8000', ws: true } } }
})
