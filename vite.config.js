import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createAssistantHandler } from './server/assistant.mjs'

export default defineConfig(({ mode }) => {
  // LOOPER_* / PATCH_* variables from .env are server-only: they never reach the browser bundle
  const env = { ...loadEnv(mode, process.cwd(), ['LOOPER_', 'PATCH_']), ...process.env }
  return {
    plugins: [
      react(),
      {
        name: 'looper-assistant-api',
        configureServer(server) {
          server.middlewares.use(createAssistantHandler(env))
        },
        configurePreviewServer(server) {
          server.middlewares.use(createAssistantHandler(env))
        },
      },
    ],
  }
})
