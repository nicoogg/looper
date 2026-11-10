// Session: the cookies and localStorage saved while you recorded.
// Loops use ctx.fetch so their calls carry your login, and new cookies are kept.
import { readFile, writeFile } from 'node:fs/promises'

function domainMatch(host, domain) {
  const d = domain.replace(/^\./, '')
  return host === d || host.endsWith('.' + d)
}

function parseSetCookie(header, url) {
  const [pair, ...attrs] = header.split(';').map((s) => s.trim())
  const eq = pair.indexOf('=')
  if (eq < 1) return null
  const cookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    domain: url.hostname,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }
  for (const a of attrs) {
    const [k, ...rest] = a.split('=')
    const v = rest.join('=')
    const key = k.toLowerCase()
    if (key === 'domain') cookie.domain = '.' + v.replace(/^\./, '')
    else if (key === 'path') cookie.path = v || '/'
    else if (key === 'expires') cookie.expires = Math.floor(Date.parse(v) / 1000) || -1
    else if (key === 'max-age') cookie.expires = Math.floor(Date.now() / 1000) + Number(v)
    else if (key === 'httponly') cookie.httpOnly = true
    else if (key === 'secure') cookie.secure = true
  }
  return cookie
}

export async function createSession(authFile) {
  let state = { cookies: [], origins: [] }
  try {
    state = JSON.parse(await readFile(authFile, 'utf8'))
  } catch {}
  let dirty = false
  const now = () => Date.now() / 1000

  const cookieHeader = (url) =>
    state.cookies
      .filter((c) => domainMatch(url.hostname, c.domain) && url.pathname.startsWith(c.path || '/') && (c.expires === -1 || c.expires > now()))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

  const store = (res, url) => {
    for (const h of res.headers.getSetCookie?.() || []) {
      const c = parseSetCookie(h, url)
      if (!c) continue
      state.cookies = state.cookies.filter((x) => !(x.name === c.name && x.domain.replace(/^\./, '') === c.domain.replace(/^\./, '') && x.path === c.path))
      if (c.expires === -1 || c.expires > now()) state.cookies.push(c)
      dirty = true
    }
  }

  async function sessionFetch(input, init = {}) {
    let url = new URL(input)
    let opts = { ...init, redirect: 'manual' }
    for (let hop = 0; hop < 8; hop++) {
      const headers = new Headers(opts.headers || {})
      const jar = cookieHeader(url)
      if (jar) headers.set('cookie', jar)
      const res = await fetch(url, { ...opts, headers })
      store(res, url)
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url)
        if (res.status !== 307 && res.status !== 308) opts = { ...opts, method: 'GET', body: undefined }
        continue
      }
      return res
    }
    throw new Error(`Too many redirects for ${input}`)
  }

  return {
    authFile,
    fetch: sessionFetch,
    cookie: (name) => state.cookies.find((c) => c.name === name)?.value,
    local: (origin, key) => state.origins.find((o) => o.origin === origin)?.localStorage?.find((i) => i.name === key)?.value,
    async save() {
      if (dirty) await writeFile(authFile, JSON.stringify(state, null, 2))
      dirty = false
    },
  }
}
