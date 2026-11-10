// The Looper assistant on the website.
// Talks to any OpenAI-compatible endpoint (Ollama by default) and runs a few tools server-side.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOOPS } from '../src/data.js'
import { aiConfig } from '../lib/ai.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REQUESTS_FILE = join(ROOT, 'data', 'requests.json')
const MAX_ROUNDS = 4
const MAX_HISTORY = 20

export const assistantConfig = aiConfig

const SYSTEM = () => `You are Looper, the assistant on the Looper website.
Looper is an open source tool: you record yourself doing a task once in any web app, and it becomes a tool an AI agent can call.

How Looper works (the only facts you may state):
- looper record <name> <url> opens a real browser. The user logs in and does the task once, then presses Enter.
- Looper reads the network traffic, finds the call that did the work, and traces CSRF tokens, account ids and bearer tokens back to where the site put them.
- It writes loops/<name>/loop.mjs: plain fetch code with the user's inputs as parameters. No browser at run time. The user owns the file.
- looper serve starts an MCP server over stdio. Every loop is a tool. looper mcp-config prints the command for Claude Code.
- looper run <name> key=value runs a loop from the terminal.
- The login session (cookies, localStorage) is saved in .looper/ on the user's machine. Login calls and passwords never go into a loop.
- When a session expires, the loop says so and looper login <url> refreshes it.
- When a site makes no usable API calls (server-rendered forms), the loop replays the clicks with Playwright instead.
- looper build <name> --ai asks a local model to name the tool and its inputs.
- Not supported yet: GraphQL-specific handling, multi-factor login refresh, websockets.
- MIT licensed, runs locally, no account, no cloud.

How you work:
- Answer only from the facts above. Never invent a feature.
- Never say you will check something: answer directly, or call a tool in the same reply.
- Do not describe your tool calls to the user. Just make them.
- Never promise to contact or follow up with the user: you cannot.
- If the user needs something Looper does not support, say so and offer to file a request with request_support. Only call it after the user agrees.
- Keep answers short: two to four sentences, plain words, no headings.
- Put each sentence on its own line.
- Reply in the user's language.`

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_examples',
      description: 'List example loops (tasks people record), optionally filtered by a word like "CRM" or "order".',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_support',
      description: 'File a request for a site type or feature Looper does not handle yet. Call only after the user agrees.',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'The site or feature' },
          note: { type: 'string', description: 'What the user wants to do' },
        },
        required: ['what'],
      },
    },
  },
]

async function runTool(name, args) {
  if (name === 'list_examples') {
    const q = String(args.query || '').toLowerCase()
    const list = LOOPS.filter((l) => !q || `${l.site} ${l.tool} ${l.desc}`.toLowerCase().includes(q)).map((l) => ({
      site: l.site,
      tool: l.tool,
      mode: l.mode === 'api' ? 'direct API calls' : 'click replay',
      what_it_does: l.desc.replace(/\n/g, ' '),
      record_with: `looper record ${l.id} <url>`,
    }))
    return { result: { examples: list }, summary: `${list.length} example${list.length === 1 ? '' : 's'}` }
  }
  if (name === 'request_support') {
    let list = []
    try {
      list = JSON.parse(await readFile(REQUESTS_FILE, 'utf8'))
    } catch {}
    list.push({ what: args.what, note: args.note || '', at: new Date().toISOString() })
    await mkdir(dirname(REQUESTS_FILE), { recursive: true })
    await writeFile(REQUESTS_FILE, JSON.stringify(list, null, 2))
    return { result: { filed: true, position: list.length }, summary: `request #${list.length} filed` }
  }
  return { result: { error: `Unknown tool ${name}` }, summary: 'unknown tool' }
}

// Some open models print the tool call as JSON text instead of using tool_calls.
function parseTextToolCalls(text) {
  const clean = text.replace(/```(?:json)?/g, '').replace(/<\/?tool_call>/g, '').trim()
  const calls = []
  const objs = clean.startsWith('[') ? tryJSON(clean) : null
  const candidates = Array.isArray(objs) ? objs : splitObjects(clean).map(tryJSON)
  for (const o of candidates) {
    if (o && typeof o.name === 'string' && TOOLS.some((t) => t.function.name === o.name)) {
      let args = o.arguments ?? o.parameters ?? {}
      if (typeof args === 'string') args = tryJSON(args) || {}
      calls.push({ name: o.name, args })
    }
  }
  return calls
}
function tryJSON(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
function splitObjects(s) {
  const out = []
  let depth = 0
  let start = -1
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') {
      if (depth++ === 0) start = i
    } else if (c === '}' && depth > 0 && --depth === 0) out.push(s.slice(start, i + 1))
  }
  return out
}

async function* sse(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      const j = tryJSON(data)
      if (j) yield j
    }
  }
}

// One model round. Streams plain text out via emit, returns tool calls if any.
async function round(cfg, messages, emit, signal) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: cfg.model, messages, tools: TOOLS, stream: true, temperature: 0.3 }),
  })
  if (!res.ok) throw new Error(`Model endpoint answered ${res.status}: ${(await res.text()).slice(0, 200)}`)

  // Text streams out as it arrives, except from the first line that looks like a
  // JSON tool call: that part is held until the round ends, then parsed or released.
  let content = ''
  let sent = 0
  let holding = false
  const HOLD = /(^|\n)[ \t]*(\{|\[|```|<tool_call>)/
  const pump = (final) => {
    if (holding) return
    const rest = content.slice(sent)
    const m = rest.search(HOLD)
    if (m >= 0) {
      const cut = m + (rest[m] === '\n' ? 1 : 0)
      if (cut) emit({ type: 'text', delta: rest.slice(0, cut) })
      sent += cut
      holding = true
      return
    }
    let cut = rest.length
    if (!final) {
      // the current line may still turn into a JSON block: wait for its first real character
      const nl = rest.lastIndexOf('\n')
      const tail = rest.slice(nl + 1)
      if (/^[ \t]*(`{1,2}|<[a-z_]*)?$/.test(tail)) cut = nl + 1
    }
    if (cut > 0) {
      emit({ type: 'text', delta: rest.slice(0, cut) })
      sent += cut
    }
  }
  const native = new Map()
  for await (const chunk of sse(res.body)) {
    const d = chunk.choices?.[0]?.delta || {}
    for (const tc of d.tool_calls || []) {
      const k = tc.index ?? native.size
      const cur = native.get(k) || { id: tc.id, name: '', args: '' }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name += tc.function.name
      if (tc.function?.arguments) cur.args += tc.function.arguments
      native.set(k, cur)
    }
    if (d.content) {
      content += d.content
      pump(false)
    }
  }

  let calls = [...native.values()].filter((c) => c.name).map((c) => ({ id: c.id, name: c.name, args: tryJSON(c.args) || {} }))
  if (holding) {
    const held = content.slice(sent)
    const parsed = calls.length ? [] : parseTextToolCalls(held)
    if (parsed.length) calls = parsed
    else emit({ type: 'text', delta: held })
  } else pump(true)
  return { content: calls.length ? '' : content, calls }
}

export async function runAssistant(cfg, history, emit, signal) {
  const messages = [{ role: 'system', content: SYSTEM() }, ...history]
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const { content, calls } = await round(cfg, messages, emit, signal)
    if (!calls.length) return
    const withIds = calls.map((c, i) => ({ ...c, id: c.id || `call_${r}_${i}` }))
    messages.push({
      role: 'assistant',
      content,
      tool_calls: withIds.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    })
    for (const c of withIds) {
      emit({ type: 'tool', id: c.id, name: c.name, args: c.args })
      const { result, summary } = await runTool(c.name, c.args)
      emit({ type: 'tool_result', id: c.id, name: c.name, summary })
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) })
    }
  }
  emit({ type: 'text', delta: 'I went in circles on that one.\nTry asking it another way.' })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (c) => {
      s += c
      if (s.length > 200_000) reject(new Error('Body too large'))
    })
    req.on('end', () => resolve(s))
    req.on('error', reject)
  })
}

function cleanHistory(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
}

async function status(cfg) {
  try {
    const r = await fetch(`${cfg.baseUrl}/models`, {
      signal: AbortSignal.timeout(2500),
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    })
    if (!r.ok) return { online: false, model: cfg.model, reason: `endpoint answered ${r.status}` }
    const j = await r.json().catch(() => ({}))
    const ids = (j.data || []).map((m) => m.id)
    const has = !ids.length || ids.includes(cfg.model)
    // Ollama: load the model in the background so the first answer is fast
    if (has && /:11434\b/.test(cfg.baseUrl)) {
      fetch(cfg.baseUrl.replace(/\/v1$/, '') + '/api/generate', {
        method: 'POST',
        body: JSON.stringify({ model: cfg.model, keep_alive: '20m' }),
      }).catch(() => {})
    }
    return has
      ? { online: true, model: cfg.model }
      : { online: false, model: cfg.model, reason: `model ${cfg.model} not found on the endpoint` }
  } catch {
    return { online: false, model: cfg.model, reason: 'model endpoint not reachable' }
  }
}

// Connect-style middleware: handles /api/looper/*, passes everything else on.
export function createAssistantHandler(env) {
  return async (req, res, next) => {
    const url = (req.url || '').split('?')[0]
    if (!url.startsWith('/api/looper/')) return next ? next() : false
    const cfg = assistantConfig(env || process.env)

    if (url === '/api/looper/status' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await status(cfg)))
      return true
    }

    if (url === '/api/looper/chat' && req.method === 'POST') {
      let history
      try {
        history = cleanHistory(JSON.parse(await readBody(req)).messages)
      } catch {
        res.statusCode = 400
        res.end('Bad request')
        return true
      }
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      const emit = (e) => !res.writableEnded && res.write(JSON.stringify(e) + '\n')
      try {
        await runAssistant(cfg, history, emit, ac.signal)
        emit({ type: 'done' })
      } catch (err) {
        if (!ac.signal.aborted) emit({ type: 'error', message: String(err.message || err) })
      }
      res.end()
      return true
    }

    res.statusCode = 404
    res.end('Not found')
    return true
  }
}
