import { readFile } from 'node:fs/promises'

// Minimal .env loader (no dependency). Existing environment variables win.
export async function loadEnvFile(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
