// Analyzer: turns a recording into a plan.
// It finds which network calls carried what you typed (the "core" calls),
// and where every other changing value in them came from (tokens, ids, CSRF).
// When the site has no usable calls, the plan falls back to replaying the UI.

const DROP_HEADERS = new Set([
  'accept-language',
  'priority',
  'cache-control',
  'pragma',
  'upgrade-insecure-requests',
  'if-none-match',
  'if-modified-since',
  'purpose',
  'dnt',
])
const MIN_DYNAMIC = 5
// Third-party hosts that only watch the page: never the action.
const TRACKERS = /(google-analytics|googletagmanager|doubleclick|googlesyndication|segment\.(io|com)|mixpanel|hotjar|sentry|amplitude|facebook|clarity\.ms|telemetry|analytics|plausible|posthog|intercom|datadog|newrelic|bugsnag|fullstory|heapanalytics|stats\.)/i
const SECRET_KEY = /pass(word)?|pwd|secret|otp|one.?time|totp|pin$|cvv|card.?number/i

export function registrable(host) {
  if (/^[\d.]+$/.test(host) || host === 'localhost') return host
  return host.split('.').slice(-2).join('.')
}

export function slug(s, fallback = 'value') {
  const out = String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(out) ? out : out ? `${fallback}_${out}` : fallback
}

function camel(s) {
  const parts = slug(s).split('_').filter(Boolean)
  return parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join('') || 'value'
}

function isJSON(ct) {
  return /json/.test(ct || '')
}

function tryJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Every scalar inside a JSON value, with its path.
export function leaves(value, path = [], out = []) {
  if (value === null || value === undefined) return out
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, [...path, i], out))
  else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, [...path, k], out)
  else out.push({ path, value })
  return out
}

// The parts of a request that can carry a value.
export function parseRequest(call) {
  const url = new URL(call.url)
  const segments = url.pathname.split('/').map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  const query = [...url.searchParams.entries()]
  const headers = Object.fromEntries(Object.entries(call.headers || {}).filter(([k]) => !DROP_HEADERS.has(k)))
  const ct = headers['content-type'] || ''
  let bodyKind = null
  let body = null
  if (call.postData != null) {
    const json = isJSON(ct) || /^\s*[[{]/.test(call.postData) ? tryJSON(call.postData) : undefined
    if (json !== undefined) {
      bodyKind = 'json'
      body = json
    } else if (/x-www-form-urlencoded/.test(ct)) {
      bodyKind = 'form'
      body = Object.fromEntries(new URLSearchParams(call.postData))
    } else {
      bodyKind = 'text'
      body = call.postData
    }
  }
  const tokens = []
  segments.forEach((s, i) => s && tokens.push({ where: 'path', index: i, value: s }))
  query.forEach(([k, v]) => v && tokens.push({ where: 'query', key: k, value: v }))
  for (const [k, v] of Object.entries(headers)) {
    if (!/^(x-|authorization$)/.test(k)) continue
    const bearer = v.match(/^(Bearer|Token|JWT)\s+(.+)$/i)
    tokens.push({ where: 'header', key: k, value: bearer ? bearer[2] : v })
  }
  if (bodyKind === 'json') leaves(body).forEach((l) => tokens.push({ where: 'body', path: l.path, value: String(l.value), raw: l.value }))
  if (bodyKind === 'form') for (const [k, v] of Object.entries(body)) tokens.push({ where: 'body', key: k, value: v })
  return { url, segments, query, headers, bodyKind, body, tokens }
}

function inputsOf(rec) {
  const last = new Map()
  for (const e of rec.events) if (e.kind === 'input') last.set(e.selector, e)
  const params = []
  const used = new Set()
  for (const e of last.values()) {
    if (e.secret || e.value == null || e.value === '') continue
    const short = (e.label || '').split(/\s+/).slice(0, 3).join(' ')
    let key = slug(e.name && !/\d{3,}/.test(e.name) ? e.name : short, 'field')
    while (used.has(key)) key += '_2'
    used.add(key)
    const type = e.inputType === 'checkbox' ? 'boolean' : /^-?\d+(\.\d+)?$/.test(e.value) && e.inputType !== 'tel' ? 'number' : 'string'
    params.push({ key, label: e.label || e.name || key, selector: e.selector, value: e.value, type, inputType: e.inputType })
  }
  return params
}

// Where did this value first show up before call `before`?
function findSource(rec, value, before, session) {
  for (let i = before - 1; i >= 0; i--) {
    const c = rec.calls[i]
    if (!c.body || !c.body.includes(value)) continue
    if (isJSON(c.contentType)) {
      const data = tryJSON(c.body)
      const hit = data !== undefined && leaves(data).find((l) => String(l.value) === value)
      if (hit) return { kind: 'json', callIndex: i, path: hit.path }
    }
    const at = c.body.indexOf(value)
    let prefix = c.body.slice(Math.max(0, at - 60), at)
    const tag = prefix.lastIndexOf('<')
    if (tag >= 0) prefix = prefix.slice(tag)
    else prefix = prefix.slice(-24)
    // Stay on one line: what came before is often another value that changes.
    const nl = prefix.lastIndexOf('\n')
    if (nl >= 0) prefix = prefix.slice(nl + 1).trimStart()
    const after = c.body[at + value.length] || ''
    if (prefix.length >= 4) return { kind: 'regex', callIndex: i, prefix, stop: after }
  }
  for (const cookie of session?.cookies || [])
    if (cookie.value === value || decodeURIComponent(cookie.value) === value) return { kind: 'cookie', name: cookie.name }
  for (const o of session?.origins || [])
    for (const item of o.localStorage || []) {
      if (item.value === value) return { kind: 'local', origin: o.origin, key: item.name }
      const data = tryJSON(item.value)
      const hit = data !== undefined && typeof data === 'object' && leaves(data).find((l) => String(l.value) === value)
      if (hit) return { kind: 'local', origin: o.origin, key: item.name, path: hit.path }
    }
  return null
}

function nameFor(source, rec, token) {
  if (source.kind === 'json') {
    const keys = source.path.filter((p) => typeof p === 'string')
    return camel(keys.slice(-2).join('_') || 'value')
  }
  if (source.kind === 'regex') {
    const attr = source.prefix.match(/(?:name|id|property)=["']([^"']+)["']/)
    if (attr) return camel(attr[1])
    const key = source.prefix.match(/["']?([A-Za-z_][\w-]*)["']?\s*[:=]\s*["']?$/)
    if (key) return camel(key[1])
  }
  if (source.kind === 'cookie') return camel(source.name)
  if (source.kind === 'local') return camel(source.path ? source.path.filter((p) => typeof p === 'string').slice(-1)[0] || source.key : source.key)
  return camel(token.key || 'token')
}

export function analyze(rec, { session } = {}) {
  const start = new URL(rec.startUrl)
  const site = registrable(start.hostname)
  rec.calls.forEach((c, i) => (c.index = i))
  const sameSite = (c) => {
    try {
      return registrable(new URL(c.url).hostname) === site
    } catch {
      return false
    }
  }
  const params = inputsOf(rec)
  const parsed = new Map(rec.calls.map((c) => [c.index, parseRequest(c)]))
  // Login calls carry passwords: they never go into a loop. The saved session covers them.
  const isLogin = (c) =>
    parsed.get(c.index).tokens.some((t) => SECRET_KEY.test(String(t.key ?? t.path?.at(-1) ?? ''))) ||
    (c.method !== 'GET' && /\/(log-?in|sign-?in|auth|session|oauth|token)\b/i.test(new URL(c.url).pathname))
  // Same-site calls first. Many sites search or store through a third-party API
  // (Algolia, Firebase, Supabase): those count too when nothing on the site itself did the work.
  const usable = (c) => c.status > 0 && !(c.type === 'document' && c.method === 'GET') && !isLogin(c) && !TRACKERS.test(new URL(c.url).hostname)
  const carries = (c) => {
    const p = parsed.get(c.index)
    return p.tokens.some((t) => params.some((x) => x.value === t.value)) || (p.bodyKind === 'text' && params.some((x) => x.value.length >= 3 && p.body.includes(x.value)))
  }
  const own = rec.calls.filter((c) => sameSite(c) && usable(c))
  const candidates = own.some(carries) || !params.length ? own : [...own, ...rec.calls.filter((c) => !sameSite(c) && usable(c))]

  // Core calls: the ones that carried what you typed.
  const byValue = new Map(params.map((p) => [p.value, p]))
  let core = candidates.filter((c) => {
    const p = parsed.get(c.index)
    if (p.tokens.some((t) => byValue.has(t.value))) return true
    return p.bodyKind === 'text' && params.some((x) => x.value.length >= 3 && p.body.includes(x.value))
  })
  // Drop GET calls that only echoed a value while you were typing (autocomplete),
  // when a call that changes something carries the same values.
  if (core.some((c) => c.method !== 'GET')) core = core.filter((c) => c.method !== 'GET' || c.index > Math.max(...core.filter((x) => x.method !== 'GET').map((x) => x.index)))
  if (!core.length) {
    const writes = candidates.filter((c) => c.method !== 'GET')
    const reads = candidates.filter((c) => c.method === 'GET' && isJSON(c.contentType))
    const pick = writes.at(-1) || reads.sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0))[0]
    if (pick) core = [pick]
  }
  if (!core.length) return { mode: 'ui', startUrl: rec.startUrl, params, actions: uiActions(rec, params) }

  const usedParams = params.filter((p) =>
    core.some((c) => {
      const x = parsed.get(c.index)
      return x.tokens.some((t) => t.value === p.value) || (x.bodyKind === 'text' && x.body.includes(p.value))
    })
  )

  // Resolve every other changing value, walking back through earlier calls.
  const steps = new Map()
  const vars = new Map() // value -> { name, source }
  const names = new Set(usedParams.map((p) => camel(p.key)))
  const addStep = (call, role) => {
    if (!steps.has(call.index)) steps.set(call.index, { call, role, parsed: parsed.get(call.index), extract: [] })
    const step = steps.get(call.index)
    if (role === 'core') step.role = 'core'
    return step
  }
  const resolve = (call, depth) => {
    const step = addStep(call, depth === 0 ? 'core' : 'dep')
    for (const t of step.parsed.tokens) {
      if (byValue.has(t.value) || vars.has(t.value) || t.value.length < MIN_DYNAMIC) continue
      // Ids and tokens have digits or are long. Plain words like "orders" are part of the route.
      if (!/\d/.test(t.value) && t.value.length < 20) continue
      const source = findSource(rec, t.value, call.index, session)
      if (!source) continue
      let name = nameFor(source, rec, t)
      while (names.has(name)) name += '2'
      names.add(name)
      vars.set(t.value, { name, source })
      if (source.callIndex !== undefined) {
        const from = rec.calls[source.callIndex]
        addStep(from, 'dep').extract.push({ name, source })
        if (depth < 3) resolve(from, depth + 1)
      }
    }
  }
  for (const c of core) resolve(c, 0)

  return {
    mode: 'api',
    origin: start.origin,
    startUrl: rec.startUrl,
    params: usedParams,
    vars: [...vars.entries()].map(([value, v]) => ({ value, ...v })),
    steps: [...steps.values()].sort((a, b) => a.call.index - b.call.index),
    actions: uiActions(rec, params),
  }
}

// What you did on screen, cleaned up, for the UI fallback.
export function uiActions(rec, params) {
  const bySelector = new Map(params.map((p) => [p.selector, p]))
  const filled = new Set()
  const out = []
  const inputs = new Set(rec.events.filter((e) => e.kind === 'input').map((e) => e.selector))
  const lastInput = new Map()
  rec.events.forEach((e, i) => e.kind === 'input' && lastInput.set(e.selector, i))
  rec.events.forEach((e, i) => {
    if (e.kind === 'input') {
      if (lastInput.get(e.selector) !== i || filled.has(e.selector)) return
      filled.add(e.selector)
      if (e.secret) return
      const p = bySelector.get(e.selector)
      if (e.inputType === 'checkbox') out.push({ do: 'check', selector: e.selector, param: p?.key, value: e.value })
      else if (e.inputType === 'select-one') out.push({ do: 'select', selector: e.selector, param: p?.key, value: e.value })
      else out.push({ do: 'fill', selector: e.selector, param: p?.key, value: e.value })
    } else if (e.kind === 'click') {
      if (inputs.has(e.selector)) return
      if (/^label/.test(e.selector)) return
      out.push({ do: 'click', selector: e.selector, text: e.text })
    }
  })
  return out
}
