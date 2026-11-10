// A small supplier portal with no public API, to try Looper on.
// Login with a session cookie, a CSRF token in the page, an account id from /api/me,
// and an order form that posts JSON. The same things real portals do.
// Run: node examples/demo-supplier/server.mjs  (http://localhost:5299, user demo / password demo)
import http from 'node:http'
import { randomBytes } from 'node:crypto'

const PORT = Number(process.env.PORT || 5299)
const sessions = new Map() // sid -> { csrf, account }
const orders = []
const CATALOG = { 'A-445': 'Steel bracket', 'B-210': 'Hex bolt M8', 'C-033': 'Cable tie 200mm' }

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px system-ui;max-width:560px;margin:40px auto;padding:0 16px}label{display:block;margin:12px 0 4px}input,select{padding:6px;width:100%}button{margin-top:16px;padding:8px 16px}</style>
</head><body>${body}</body></html>`

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

function session(req) {
  const sid = (req.headers.cookie || '').match(/sid=([^;]+)/)?.[1]
  return sid && sessions.get(sid)
}

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const s = session(req)

    if (url.pathname === '/login' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(
        page(
          'Login',
          `<h1>Supplier portal</h1><form method="post" action="/login">
          <label for="user">User</label><input id="user" name="user" autocomplete="username">
          <label for="password">Password</label><input id="password" name="password" type="password">
          <button type="submit">Log in</button></form>`
        )
      )
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req))
      if (form.get('user') !== 'demo' || form.get('password') !== 'demo') {
        res.writeHead(303, { location: '/login' })
        return res.end()
      }
      const sid = randomBytes(12).toString('hex')
      sessions.set(sid, { csrf: randomBytes(16).toString('hex'), account: 'acc_' + randomBytes(4).toString('hex') })
      res.writeHead(303, { location: '/orders', 'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` })
      return res.end()
    }

    if (!s) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'not logged in' })
      res.writeHead(302, { location: '/login' })
      return res.end()
    }

    if (url.pathname === '/' || url.pathname === '/orders') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(
        page(
          'Orders',
          `<meta name="csrf-token" content="${s.csrf}">
          <h1>New order</h1>
          <form id="order">
            <label for="sku">Product code</label>
            <select id="sku" name="sku">${Object.entries(CATALOG).map(([k, v]) => `<option value="${k}">${k} · ${v}</option>`).join('')}</select>
            <label for="qty">Quantity</label><input id="qty" name="qty" inputmode="numeric">
            <label for="note">Delivery note</label><input id="note" name="note">
            <button type="submit">Place order</button>
          </form>
          <p id="result"></p>
          <script>
            let account
            fetch('/api/me').then(r => r.json()).then(d => { account = d.account.id })
            document.getElementById('order').addEventListener('submit', async (e) => {
              e.preventDefault()
              const f = new FormData(e.target)
              const res = await fetch('/api/accounts/' + account + '/orders', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-csrf-token': document.querySelector('meta[name=csrf-token]').content },
                body: JSON.stringify({ sku: f.get('sku'), quantity: Number(f.get('qty')), note: f.get('note'), channel: 'web' }),
              })
              const d = await res.json()
              document.getElementById('result').textContent = res.ok ? 'Order ' + d.order.id + ' placed' : d.error
            })
          </script>`
        )
      )
    }
    if (url.pathname === '/api/me') return json(res, 200, { user: 'demo', account: { id: s.account, plan: 'pro' } })

    const m = url.pathname.match(/^\/api\/accounts\/([^/]+)\/orders$/)
    if (m && req.method === 'POST') {
      if (m[1] !== s.account) return json(res, 404, { error: 'unknown account' })
      if (req.headers['x-csrf-token'] !== s.csrf) return json(res, 403, { error: 'bad csrf token' })
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!CATALOG[body.sku] || !(body.quantity > 0)) return json(res, 400, { error: 'invalid order' })
      const order = { id: 'ord_' + (1000 + orders.length), sku: body.sku, quantity: body.quantity, note: body.note || '', status: 'placed' }
      orders.push(order)
      return json(res, 201, { order })
    }
    if (m && req.method === 'GET') return json(res, 200, { orders })

    json(res, 404, { error: 'not found' })
  })
  .listen(PORT, () => console.log(`Demo supplier portal on http://localhost:${PORT} (demo / demo)`))
