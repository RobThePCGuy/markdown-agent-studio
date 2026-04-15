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
        manualChunks(id) {
          const inNodeModules = id.includes('/node_modules/') || id.includes('\\node_modules\\')
          if (!inNodeModules) return undefined

          if (id.includes('/@xyflow/react/') || id.includes('\\@xyflow\\react\\')) {
            return 'vendor-flow'
          }

          if (
            id.includes('/@monaco-editor/react/') ||
            id.includes('\\@monaco-editor\\react\\') ||
            id.includes('/monaco-editor/') ||
            id.includes('\\monaco-editor\\')
          ) {
            return 'vendor-monaco'
          }

          if (id.includes('/@google/genai/') || id.includes('\\@google\\genai\\')) {
            return 'vendor-google'
          }

          if (
            id.includes('/react-markdown/') ||
            id.includes('\\react-markdown\\') ||
            id.includes('/remark-gfm/') ||
            id.includes('\\remark-gfm\\') ||
            id.includes('/rehype-sanitize/') ||
            id.includes('\\rehype-sanitize\\') ||
            id.includes('/react-syntax-highlighter/') ||
            id.includes('\\react-syntax-highlighter\\') ||
            id.includes('/prismjs/') ||
            id.includes('\\prismjs\\')
          ) {
            return 'vendor-markdown'
          }

          if (id.includes('/@anthropic-ai/sdk/') || id.includes('\\@anthropic-ai\\sdk\\')) {
            return 'vendor-anthropic'
          }

          if (id.includes('/openai/') || id.includes('\\openai\\')) {
            return 'vendor-openai'
          }

          if (id.includes('/@modelcontextprotocol/sdk/') || id.includes('\\@modelcontextprotocol\\sdk\\')) {
            return 'vendor-mcp'
          }

          if (
            id.includes('/@xenova/transformers/') ||
            id.includes('\\@xenova\\transformers\\') ||
            id.includes('/onnxruntime-web/') ||
            id.includes('\\onnxruntime-web\\')
          ) {
            return 'vendor-memory'
          }

          if (
            id.includes('/gray-matter/') ||
            id.includes('\\gray-matter\\') ||
            id.includes('/js-yaml/') ||
            id.includes('\\js-yaml\\')
          ) {
            return 'vendor-parsing'
          }

          return undefined
        },
      },
    },
  },
})
