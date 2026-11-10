// Recorder: opens a real browser, lets you do the task once,
// and captures both what you did (inputs, clicks) and the network traffic it caused.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright'

const TEXT_TYPES = /json|text|javascript|xml|x-www-form-urlencoded/
const MAX_BODY = 256 * 1024
// Streaming responses (SSE, long polling) never finish: never wait on them forever.
const settle = (promises, ms = 4000) => Promise.race([Promise.allSettled(promises), new Promise((r) => setTimeout(r, ms))])

const SKIP_HEADERS = new Set(['cookie', 'content-length', 'host', 'connection', 'accept-encoding'])

// Runs inside the page: reports what the user types and clicks.
function pageScript() {
  const label = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    const text = (byFor || el.closest('label'))?.innerText
    return (text || el.getAttribute('aria-label') || el.placeholder || el.name || '').trim().slice(0, 80)
  }
  const selector = (el) => {
    if (el.id && !/\d{3,}/.test(el.id)) return `#${CSS.escape(el.id)}`
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`
    const aria = el.getAttribute('aria-label')
    if (aria) return `[aria-label="${aria}"]`
    const text = (el.innerText || el.value || '').trim()
    if (text && text.length < 40 && /^(BUTTON|A)$/.test(el.tagName)) return `${el.tagName.toLowerCase()}:has-text("${text}")`
    const path = []
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
      path.unshift(same.length > 1 ? `${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})` : n.tagName.toLowerCase())
    }
    return path.join(' > ')
  }
  const send = (e) => window.__looperEvent?.({ ...e, url: location.href, t: Date.now() })
  document.addEventListener(
    'change',
    (ev) => {
      const el = ev.target
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return
      const secret = el.type === 'password' || /otp|one-time/.test(el.autocomplete || '')
      send({
        kind: 'input',
        selector: selector(el),
        name: el.name || el.id || '',
        label: label(el),
        inputType: el.type || el.tagName.toLowerCase(),
        value: secret ? null : el.type === 'checkbox' ? String(el.checked) : el.value,
        secret,
      })
    },
    true
  )
  document.addEventListener(
    'click',
    (ev) => {
      const el = ev.target.closest('button, a, [role="button"], input[type="submit"], input[type="checkbox"], label') || ev.target
      send({ kind: 'click', selector: selector(el), text: (el.innerText || el.value || '').trim().slice(0, 60) })
    },
    true
  )
}

export async function record({ url, out, authFile, headless = false, actor, stop, onReady }) {
  const browser = await chromium.launch({ headless }).catch((err) => {
    if (/Executable doesn't exist|playwright install/i.test(err.message))
      throw new Error('The browser Looper records with is not installed yet.\nRun: npx playwright install chromium')
    throw err
  })
  let storageState
  try {
    storageState = JSON.parse(await readFile(authFile, 'utf8'))
  } catch {}
  const context = await browser.newContext({ storageState })
  const events = []
  const calls = []
  const started = Date.now()

  await context.exposeBinding('__looperEvent', (_src, e) => events.push({ ...e, t: e.t - started }))
  await context.addInitScript(pageScript)

  const pending = []
  context.on('requestfinished', (request) => pending.push(capture(request)))
  context.on('requestfailed', (request) => pending.push(capture(request)))

  async function capture(request) {
    const type = request.resourceType()
    if (!['xhr', 'fetch', 'document'].includes(type)) return
    const t = Date.now() - started
    const response = await request.response().catch(() => null)
    const headers = {}
    for (const [k, v] of Object.entries(await request.allHeaders().catch(() => request.headers())))
      if (!SKIP_HEADERS.has(k) && !k.startsWith(':') && !k.startsWith('sec-')) headers[k] = v
    let body = null
    let contentType = ''
    if (response) {
      contentType = (await response.headerValue('content-type').catch(() => '')) || ''
      if (TEXT_TYPES.test(contentType) && !/event-stream/.test(contentType)) {
        const buf = await Promise.race([response.body().catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))])
        if (buf && buf.length <= MAX_BODY) body = buf.toString('utf8')
      }
    }
    calls.push({
      t,
      type,
      method: request.method(),
      url: request.url(),
      headers,
      postData: request.postData(),
      status: response?.status() ?? 0,
      contentType,
      body,
    })
  }

  // The session (cookies, localStorage) is snapshotted while the browser is open,
  // so closing the window by hand still keeps the login.
  let session = storageState
  const snapshot = async () => {
    try {
      session = await context.storageState()
    } catch {}
  }
  const timer = setInterval(snapshot, 1500)

  const page = await context.newPage()
  const closed = new Promise((resolve) => browser.on('disconnected', resolve))
  await page.goto(url)
  onReady?.()

  if (actor) await actor(page)
  else await Promise.race([closed, stop ?? new Promise(() => {})])

  clearInterval(timer)
  if (browser.isConnected()) {
    await page.waitForTimeout(400).catch(() => {})
    await settle(pending)
    await snapshot()
    await browser.close()
  }
  await settle(pending, 1000)

  if (session) {
    await mkdir(dirname(authFile), { recursive: true })
    await writeFile(authFile, JSON.stringify(session, null, 2))
  }

  calls.sort((a, b) => a.t - b.t)
  const recording = { version: 1, startUrl: url, recordedAt: new Date().toISOString(), events, calls }
  if (out) {
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, JSON.stringify(recording, null, 2))
  }
  return recording
}
