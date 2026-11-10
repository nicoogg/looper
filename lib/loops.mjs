// Where loops live, and how they are loaded and run.
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSession } from './session.mjs'

export function paths(dir) {
  const root = resolve(dir)
  return {
    root,
    loops: join(root, 'loops'),
    loop: (name) => join(root, 'loops', name, 'loop.mjs'),
    recording: (name) => join(root, '.looper', 'recordings', `${name}.json`),
    auth: join(root, '.looper', 'session.json'),
  }
}

export async function listLoops(dir) {
  const p = paths(dir)
  let names = []
  try {
    names = await readdir(p.loops)
  } catch {
    return []
  }
  const out = []
  for (const name of names.sort()) {
    const file = p.loop(name)
    try {
      const s = await stat(file)
      const mod = await import(`${pathToFileURL(file).href}?v=${s.mtimeMs}`)
      if (mod.tool && typeof mod.run === 'function') out.push({ name, file, tool: mod.tool, run: mod.run })
    } catch (err) {
      out.push({ name, file, error: err.message })
    }
  }
  return out
}

export function coerce(tool, raw) {
  const props = tool.inputSchema?.properties || {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    const t = props[k]?.type
    out[k] = t === 'number' && typeof v === 'string' ? Number(v) : t === 'boolean' && typeof v === 'string' ? v === 'true' : v
  }
  return out
}

export async function runLoop(dir, loop, input) {
  const ctx = await createSession(paths(dir).auth)
  try {
    return await loop.run(coerce(loop.tool, input), ctx)
  } finally {
    await ctx.save()
  }
}
