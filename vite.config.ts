import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'global': 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-flow': ['@xyflow/react'],
          'vendor-monaco': ['@monaco-editor/react'],
          'vendor-google': ['@google/generative-ai'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'react-syntax-highlighter'],
        },
      },
    },
  },
})
