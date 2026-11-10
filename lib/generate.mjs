// Generator: turns a plan into a plain JavaScript file you own.
// API mode calls the site's own endpoints with fetch, no browser.
// UI mode replays your clicks with Playwright when there is nothing better.

const q = (s) => JSON.stringify(s)
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const ident = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k))

function inputSchema(params) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      params.map((p) => [p.key, { type: p.type, description: `${p.label} (recorded: ${p.value})` }])
    ),
    required: params.map((p) => p.key),
  }
}

// value -> JS expression, from params and extracted variables.
function exprMap(plan) {
  const map = new Map()
  for (const p of plan.params) map.set(p.value, { expr: `input.${p.key}`, type: p.type })
  for (const v of plan.vars) map.set(v.value, { expr: v.name, type: 'dynamic' })
  return map
}

function asString(m) {
  return m.type === 'string' || m.type === 'dynamic' ? m.expr : `String(${m.expr})`
}

function urlSource(parsed, map) {
  const { url, segments, query } = parsed
  const path = segments
    .map((s) => {
      const m = map.get(s)
      return m ? `\${encodeURIComponent(${asString(m)})}` : esc(encodeURIComponent(s).replace(/%40/g, '@').replace(/%3A/g, ':'))
    })
    .join('/')
  const qs = query
    .map(([k, v]) => {
      const m = map.get(v)
      return `${esc(encodeURIComponent(k))}=${m ? `\${encodeURIComponent(${asString(m)})}` : esc(encodeURIComponent(v))}`
    })
    .join('&')
  return `\`${esc(url.origin)}${path}${qs ? '?' + qs : ''}\``
}

function jsonSource(value, map, indent) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map((v) => pad + '  ' + jsonSource(v, map, indent + 1)).join(',\n')},\n${pad}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return '{}'
    return `{\n${entries.map(([k, v]) => `${pad}  ${ident(k)}: ${jsonSource(v, map, indent + 1)}`).join(',\n')},\n${pad}}`
  }
  const m = value === null ? null : map.get(String(value))
  if (!m) return JSON.stringify(value)
  if (typeof value === 'number') return m.type === 'number' ? m.expr : `Number(${m.expr})`
  if (typeof value === 'boolean') return m.type === 'boolean' ? m.expr : `${m.expr} === true || ${m.expr} === 'true'`
  return asString(m)
}

function textSource(text, map) {
  let out = esc(text)
  const values = [...map.keys()].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length)
  for (const v of values) out = out.split(esc(v)).join(`\${${asString(map.get(v))}}`)
  return `\`${out}\``
}

function headerSource(headers, map, bodyKind) {
  const lines = []
  for (const [k, v] of Object.entries(headers)) {
    if (k === 'content-type' && !bodyKind) continue
    const bearer = v.match(/^(Bearer|Token|JWT)\s+(.+)$/i)
    const m = map.get(bearer ? bearer[2] : v)
    const val = m ? (bearer ? `\`${bearer[1]} \${${asString(m)}}\`` : asString(m)) : q(v)
    lines.push(`      ${q(k)}: ${val},`)
  }
  return lines.length ? `{\n${lines.join('\n')}\n    }` : '{}'
}

function extractSource(e, bodyVar) {
  const s = e.source
  if (s.kind === 'json') return `need(${bodyVar}${s.path.map((p) => `?.[${q(p)}]`).join('')}, ${q(e.name)})`
  const stop = s.stop && s.stop !== '\\' ? `[^${reEsc(s.stop)}]+` : `[^"'<\\s]+`
  const prefix = reEsc(s.prefix).replace(/\s+/g, '\\s*')
  return `need(${bodyVar}.match(/${prefix}(${stop})/)?.[1], ${q(e.name)})`
}

// /api/accounts/acc_123/orders -> /api/accounts/{accountId}/orders
export function routeOf(step, plan) {
  const names = new Map(plan.vars.map((v) => [v.value, v.name]))
  for (const p of plan.params) names.set(p.value, p.key)
  return step.parsed.segments.map((s) => (names.has(s) ? `{${names.get(s)}}` : s)).join('/')
}

function apiCode(name, plan, description) {
  const map = exprMap(plan)
  const out = []
  // Values read straight from the saved session (cookies, localStorage).
  for (const v of plan.vars) {
    if (v.source.kind === 'cookie') out.push(`  const ${v.name} = need(ctx.cookie(${q(v.source.name)}), ${q(v.name)})`)
    if (v.source.kind === 'local') {
      const path = (v.source.path || []).map((p) => `?.[${q(p)}]`).join('')
      const read = `ctx.local(${q(v.source.origin)}, ${q(v.source.key)})`
      out.push(`  const ${v.name} = need(${path ? `JSON.parse(${read} || 'null')${path}` : read}, ${q(v.name)})`)
    }
  }
  if (out.length) out.push('')
  let last = null
  plan.steps.forEach((step, i) => {
    const n = i + 1
    const { call, parsed } = step
    const what = step.extract.length ? `finds ${step.extract.map((e) => e.name).join(', ')}` : 'the action you recorded'
    out.push(`  // ${n}. ${call.method} ${routeOf(step, plan)} · ${what}`)
    let body = ''
    if (parsed.bodyKind === 'json') body = `    body: JSON.stringify(${jsonSource(parsed.body, map, 2)}),\n`
    else if (parsed.bodyKind === 'form') body = `    body: new URLSearchParams(${jsonSource(parsed.body, map, 2)}).toString(),\n`
    else if (parsed.bodyKind === 'text') body = `    body: ${textSource(parsed.body, map)},\n`
    out.push(`  const res${n} = await http(ctx, ${urlSource(parsed, map)}, {`)
    out.push(`    method: ${q(call.method)},`)
    out.push(`    headers: ${headerSource(parsed.headers, map, parsed.bodyKind)},`)
    if (body) out.push(body.replace(/\n$/, ''))
    out.push('  })')
    out.push(`  const body${n} = await read(res${n})`)
    for (const e of step.extract) out.push(`  const ${e.name} = ${extractSource(e, `body${n}`)}`)
    out.push('')
    if (step.role === 'core') last = n
  })
  out.push(`  return body${last}`)

  return `// Looper loop: ${name}
// Recorded on ${plan.origin} (${new Date().toISOString().slice(0, 10)}).
// Plain code that calls the site's own endpoints, no browser needed.
// It is yours: read it, edit it, commit it.

export const tool = ${JSON.stringify({ name, description, inputSchema: inputSchema(plan.params) }, null, 2)}

export async function run(input, ctx) {
${out.join('\n')}
}

// Helpers

async function http(ctx, url, init) {
  const res = await (ctx?.fetch ?? fetch)(url, init)
  if (res.status === 401 || res.status === 403 || (res.url && res.url !== url && /log-?in|sign-?in|auth/i.test(new URL(res.url).pathname)))
    throw new Error(\`The session for \${new URL(url).origin} has expired. Run: looper login \${new URL(url).origin}\`)
  if (!res.ok) throw new Error(\`\${init?.method || 'GET'} \${url} answered \${res.status}\`)
  return res
}

async function read(res) {
  const text = await res.text()
  if (/json/.test(res.headers.get('content-type') || '')) {
    try {
      return JSON.parse(text)
    } catch {}
  }
  return text
}

function need(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(\`Could not find \${name}: the site may have changed. Record the loop again.\`)
  return value
}
`
}

function uiCode(name, plan, description) {
  const lines = plan.actions.map((a) => {
    const val = a.param ? (a.do === 'check' ? `Boolean(input.${a.param})` : `String(input.${a.param})`) : a.do === 'check' ? String(a.value === 'true') : q(a.value)
    if (a.do === 'fill') return `    await page.fill(${q(a.selector)}, ${val})`
    if (a.do === 'select') return `    await page.selectOption(${q(a.selector)}, ${val})`
    if (a.do === 'check') return `    await page.setChecked(${q(a.selector)}, ${val})`
    return `    await page.click(${q(a.selector)}) // ${a.text || ''}`.trimEnd()
  })
  return `// Looper loop: ${name}
// Recorded on ${new URL(plan.startUrl).origin} (${new Date().toISOString().slice(0, 10)}).
// The site showed no usable API calls, so this replays your clicks in a headless browser.
// It is yours: read it, edit it, commit it.
import { chromium } from 'playwright'

export const tool = ${JSON.stringify({ name, description, inputSchema: inputSchema(plan.params) }, null, 2)}

export async function run(input, ctx) {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ storageState: ctx?.authFile })
    const page = await context.newPage()
    await page.goto(${q(plan.startUrl)})
${lines.join('\n')}
    await page.waitForLoadState('networkidle').catch(() => {})
    return { url: page.url(), text: (await page.innerText('body')).slice(0, 4000) }
  } finally {
    await browser.close()
  }
}
`
}

export function generate(name, plan, description) {
  const desc =
    description ||
    (plan.mode === 'api'
      ? `Replays "${name}" on ${new URL(plan.origin).host}: ${plan.steps.filter((s) => s.role === 'core').map((s) => `${s.call.method} ${routeOf(s, plan)}`).join(', ')}`
      : `Replays "${name}" on ${new URL(plan.startUrl).host} through the browser`)
  return plan.mode === 'api' ? apiCode(name, plan, desc) : uiCode(name, plan, desc)
}

export function summary(plan) {
  const lines = []
  lines.push(plan.mode === 'api' ? 'Mode: API (direct calls, no browser)' : 'Mode: UI replay (no usable API calls found)')
  lines.push(`Inputs: ${plan.params.map((p) => `${p.key} (${p.type}, "${p.label}")`).join(', ') || 'none'}`)
  if (plan.mode === 'api') {
    for (const s of plan.steps)
      lines.push(`  ${s.role === 'core' ? '★' : '·'} ${s.call.method} ${routeOf(s, plan)}${s.extract.length ? ` → ${s.extract.map((e) => e.name).join(', ')}` : ''}`)
    for (const v of plan.vars.filter((x) => x.source.kind === 'cookie' || x.source.kind === 'local'))
      lines.push(`  · ${v.name} from ${v.source.kind === 'cookie' ? 'cookie' : 'localStorage'} ${v.source.name || v.source.key}`)
  } else for (const a of plan.actions) lines.push(`  · ${a.do} ${a.selector}${a.param ? ` ← ${a.param}` : ''}`)
  return lines.join('\n')
}
