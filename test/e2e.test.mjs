// End to end: record an order on the demo portal, build the loop,
// run it with new values, then call it through the MCP server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { record } from '../lib/record.mjs'
import { analyze } from '../lib/analyze.mjs'
import { generate, summary } from '../lib/generate.mjs'
import { listLoops, paths, runLoop } from '../lib/loops.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5391
const BASE = `http://localhost:${PORT}`
const dir = await mkdtemp(join(tmpdir(), 'looper-'))
const p = paths(dir)

const demo = spawn(process.execPath, [join(ROOT, 'examples/demo-supplier/server.mjs')], { env: { ...process.env, PORT: String(PORT) } })
await new Promise((r) => demo.stdout.once('data', r))

let failed = false
const step = async (title, fn) => {
  try {
    await fn()
    console.log(`✓ ${title}`)
  } catch (err) {
    failed = true
    console.log(`✗ ${title}\n  ${err.stack}`)
  }
}

try {
  let rec, plan
  await step('records a login and an order', async () => {
    rec = await record({
      url: `${BASE}/orders`,
      out: p.recording('place_order'),
      authFile: p.auth,
      headless: true,
      actor: async (page) => {
        await page.fill('#user', 'demo')
        await page.fill('#password', 'demo')
        await page.click('button[type=submit]')
        await page.waitForURL('**/orders')
        await page.waitForLoadState('networkidle')
        await page.selectOption('#sku', 'B-210')
        await page.fill('#qty', '20')
        await page.fill('#note', 'Leave at the gate')
        await page.click('button[type=submit]')
        await page.waitForFunction(() => document.getElementById('result').textContent.startsWith('Order'))
      },
    })
    assert.ok(rec.calls.length >= 4, `only ${rec.calls.length} calls`)
  })

  await step('finds the hidden API, its inputs and dependencies', async () => {
    const session = JSON.parse(await readFile(p.auth, 'utf8'))
    plan = analyze(rec, { session })
    console.log(summary(plan).replace(/^/gm, '    '))
    assert.equal(plan.mode, 'api')
    assert.deepEqual(plan.params.map((x) => x.key).sort(), ['note', 'qty', 'sku'])
    const core = plan.steps.filter((s) => s.role === 'core')
    assert.equal(core.length, 1)
    assert.match(core[0].parsed.url.pathname, /\/api\/accounts\/.+\/orders/)
    const names = plan.vars.map((v) => v.name)
    assert.ok(names.includes('csrfToken'), `vars: ${names}`)
    assert.ok(names.includes('accountId'), `vars: ${names}`)
    assert.ok(!plan.steps.some((s) => s.parsed.url.pathname === '/login'), 'login call leaked into the loop')
  })

  await step('writes readable code with no secrets in it', async () => {
    const code = generate('place_order', plan)
    await mkdir(dirname(p.loop('place_order')), { recursive: true })
    await writeFile(p.loop('place_order'), code)
    assert.ok(!/password/i.test(code), 'password found in generated code')
    const session = JSON.parse(await readFile(p.auth, 'utf8'))
    for (const ck of session.cookies) assert.ok(!code.includes(ck.value), `cookie ${ck.name} hard-coded`)
    assert.match(code, /input\.qty/)
  })

  await step('runs the loop with new values, without a browser', async () => {
    const [loop] = await listLoops(dir)
    const out = await runLoop(dir, loop, { sku: 'C-033', qty: '5', note: 'Urgent' })
    assert.equal(out.order.sku, 'C-033')
    assert.equal(out.order.quantity, 5)
    assert.equal(out.order.note, 'Urgent')
  })

  await step('serves the loop as an MCP tool', async () => {
    const client = new Client({ name: 'looper-test', version: '0.0.0' })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'bin/looper.mjs'), 'serve', '--dir', dir] }))
    const { tools } = await client.listTools()
    assert.equal(tools[0].name, 'place_order')
    assert.equal(tools[0].inputSchema.properties.qty.type, 'number')
    const res = await client.callTool({ name: 'place_order', arguments: { sku: 'A-445', qty: 3, note: 'From MCP' } })
    assert.ok(!res.isError, res.content?.[0]?.text)
    assert.equal(JSON.parse(res.content[0].text).order.sku, 'A-445')
    await client.close()
  })

  await step('reports an expired session clearly', async () => {
    const session = JSON.parse(await readFile(p.auth, 'utf8'))
    session.cookies = []
    await writeFile(p.auth, JSON.stringify(session))
    const [loop] = await listLoops(dir)
    await assert.rejects(runLoop(dir, loop, { sku: 'A-445', qty: 1, note: '' }), /expired.*looper login/)
  })

  await step('falls back to replaying clicks when there is no API', async () => {
    const rec2 = {
      startUrl: `${BASE}/login`,
      events: [
        { kind: 'input', selector: '#user', name: 'user', label: 'User', inputType: 'text', value: 'demo' },
        { kind: 'input', selector: '#password', name: 'password', label: 'Password', inputType: 'password', value: null, secret: true },
        { kind: 'click', selector: 'button:has-text("Log in")', text: 'Log in' },
      ],
      calls: [],
    }
    const plan2 = analyze(rec2)
    assert.equal(plan2.mode, 'ui')
    const code = generate('ui_login', plan2)
    assert.match(code, /page\.fill\("#user", String\(input\.user\)\)/)
    assert.ok(!code.includes('#password'), 'secret field replayed')
  })
} finally {
  demo.kill()
  await rm(dir, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log('\nAll good.')
