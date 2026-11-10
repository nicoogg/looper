#!/usr/bin/env node
// looper: show it once, it becomes a tool.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { loadEnvFile } from '../server/env.mjs'
import { record } from '../lib/record.mjs'
import { analyze, slug } from '../lib/analyze.mjs'
import { generate, summary } from '../lib/generate.mjs'
import { listLoops, paths, runLoop } from '../lib/loops.mjs'
import { describe } from '../lib/ai.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

function parseArgs(argv) {
  const out = { _: [], kv: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (['yes', 'ai', 'headless', 'help', 'json'].includes(k)) out[k] = true
      else out[k] = argv[++i]
    } else if (a === '-y') out.yes = true
    else if (/^[\w-]+=/.test(a) && out._.length >= 2) {
      const eq = a.indexOf('=')
      out.kv[a.slice(0, eq)] = a.slice(eq + 1)
    } else out._.push(a)
  }
  return out
}

const HELP = `${c.bold('looper')} ${c.dim('v' + VERSION)} · show it once, it becomes a tool

  looper record <name> <url>     Open a browser, do the task once, close it or press Enter
  looper build <name> [--ai]     Rebuild the loop from its recording (--ai: names from a local model)
  looper run <name> key=value    Run a loop from the terminal
  looper list                    Show your loops
  looper login <url>             Log in again when a session expires
  looper serve                   Start the MCP server (stdio) with every loop as a tool
  looper mcp-config              Print the command that adds Looper to Claude Code

  Options: --dir <path> (default: current folder) · --yes · --describe "text" · --headless
`

async function exists(f) {
  try {
    await access(f)
    return true
  } catch {
    return false
  }
}

async function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(q)
  rl.close()
  return a
}

function waitForEnter() {
  if (!process.stdin.isTTY) return new Promise(() => {})
  const rl = createInterface({ input: process.stdin })
  return new Promise((resolve) => rl.once('line', () => (rl.close(), resolve())))
}

async function build(dir, name, args, recording) {
  const p = paths(dir)
  if (!recording) recording = JSON.parse(await readFile(p.recording(name), 'utf8'))
  let session
  try {
    session = JSON.parse(await readFile(p.auth, 'utf8'))
  } catch {}
  const plan = analyze(recording, { session })
  let description = args.describe
  if (args.ai && !description) {
    process.stdout.write(c.dim('Asking the model to name the tool… '))
    try {
      description = await describe(name, plan, recording)
      console.log(c.green('done'))
    } catch (err) {
      console.log(c.dim(`skipped (${err.message})`))
    }
  }
  const code = generate(name, plan, description)
  const file = p.loop(name)
  console.log('\n' + summary(plan) + '\n')
  if ((await exists(file)) && !args.yes) {
    const a = await ask(`${relative(process.cwd(), file)} exists. Overwrite it? [y/N] `)
    if (!/^y/i.test(a)) return console.log(c.dim('Left as it was.'))
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, code)
  console.log(`${c.green('✓')} Wrote ${c.bold(relative(process.cwd(), file) || file)}`)
  console.log(c.dim(`  Try it: looper run ${name} ${plan.params.map((x) => `${x.key}=${JSON.stringify(x.value)}`).join(' ')}`))
}

const args = parseArgs(process.argv.slice(2))
const [cmd, ...rest] = args._
const dir = args.dir || process.cwd()
await loadEnvFile(join(dir, '.env'))

try {
  if (!cmd || args.help || cmd === 'help') console.log(HELP)
  else if (cmd === 'record') {
    const [rawName, url] = rest
    if (!rawName || !url) throw new Error('Usage: looper record <name> <url>')
    const name = slug(rawName, 'loop')
    const p = paths(dir)
    console.log(`${c.cyan('●')} Recording ${c.bold(name)}`)
    console.log('  Do the task once in the browser window, as you normally would.')
    console.log(c.dim('  Log in first if you need to: the session is saved in .looper/ and never leaves your machine.'))
    console.log(`  When you are done, ${c.bold('press Enter here')} or close the window.\n`)
    const recording = await record({ url, out: p.recording(name), authFile: p.auth, headless: args.headless, stop: waitForEnter() })
    console.log(`${c.green('✓')} Captured ${recording.events.length} actions and ${recording.calls.length} requests`)
    await build(dir, name, args, recording)
    process.exit(0)
  } else if (cmd === 'build') {
    if (!rest[0]) throw new Error('Usage: looper build <name>')
    await build(dir, slug(rest[0], 'loop'), args)
  } else if (cmd === 'run') {
    const name = slug(rest[0] || '', 'loop')
    const loop = (await listLoops(dir)).find((l) => l.name === name)
    if (!loop) throw new Error(`No loop called ${name}. See: looper list`)
    if (loop.error) throw new Error(loop.error)
    const result = await runLoop(dir, loop, args.kv)
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
  } else if (cmd === 'list') {
    const loops = await listLoops(dir)
    if (!loops.length) console.log(c.dim('No loops yet. Start with: looper record <name> <url>'))
    for (const l of loops) {
      if (l.error) console.log(`${c.red('✗')} ${l.name} ${c.dim(l.error)}`)
      else console.log(`${c.green('●')} ${c.bold(l.tool.name)}(${Object.keys(l.tool.inputSchema.properties).join(', ')})\n  ${c.dim(l.tool.description)}`)
    }
  } else if (cmd === 'login') {
    const url = rest[0]
    if (!url) throw new Error('Usage: looper login <url>')
    console.log('Log in in the browser window, then press Enter here or close the window.')
    await record({ url, authFile: paths(dir).auth, stop: waitForEnter() })
    console.log(`${c.green('✓')} Session saved`)
    process.exit(0)
  } else if (cmd === 'serve') {
    const { serve } = await import('../lib/mcp.mjs')
    await serve(dir, VERSION)
  } else if (cmd === 'mcp-config') {
    const bin = join(ROOT, 'bin', 'looper.mjs')
    console.log(`claude mcp add looper -- node ${JSON.stringify(bin)} serve --dir ${JSON.stringify(paths(dir).root)}`)
  } else throw new Error(`Unknown command "${cmd}".\n\n${HELP}`)
} catch (err) {
  console.error(c.red('✗ ') + err.message)
  process.exit(1)
}
