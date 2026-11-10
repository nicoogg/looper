// Standalone Looper website server: serves the built site and the assistant API.
// Usage: npm run build && npm start
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAssistantHandler, assistantConfig } from './assistant.mjs'
import { loadEnvFile } from './env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
await loadEnvFile(join(ROOT, '.env'))
const PORT = Number(process.env.PORT || 4747)
const HOST = process.env.HOST || '127.0.0.1'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

const assistant = createAssistantHandler()

http
  .createServer(async (req, res) => {
    if (await assistant(req, res, null)) return
    const path = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    let file = join(DIST, path)
    if (!file.startsWith(DIST)) {
      res.statusCode = 403
      return res.end()
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(DIST, 'index.html')
    }
    try {
      const body = await readFile(file)
      res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream')
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end('Run "npm run build" first.')
    }
  })
  .listen(PORT, HOST, () => {
    const cfg = assistantConfig()
    console.log(`✓ Looper site on http://${HOST}:${PORT}`)
    console.log(`  model ${cfg.model} via ${cfg.baseUrl}`)
  })
