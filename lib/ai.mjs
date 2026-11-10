// Optional: a local model names the tool and its inputs so agents understand them.
// Runs on any OpenAI-compatible endpoint, Ollama on your machine by default.
import { complete, parseJSON } from '../server/llm.mjs'
import { slug } from './analyze.mjs'

export function aiConfig(env = process.env) {
  return {
    baseUrl: (env.LOOPER_BASE_URL || env.PATCH_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, ''),
    model: env.LOOPER_MODEL || env.PATCH_MODEL || 'qwen2.5-coder:14b',
    apiKey: env.LOOPER_API_KEY || env.PATCH_API_KEY || '',
  }
}

export async function describe(name, plan, recording, cfg = aiConfig()) {
  const calls =
    plan.mode === 'api'
      ? plan.steps.filter((s) => s.role === 'core').map((s) => `${s.call.method} ${s.parsed.url.pathname} → ${String(s.call.body || '').slice(0, 300)}`)
      : plan.actions.map((a) => `${a.do} ${a.selector} ${a.text || ''}`)
  const prompt = `A user recorded a task in a web app so an AI agent can repeat it as a tool.
Recording name: ${name}
Site: ${new URL(plan.startUrl).host}
Page titles and clicks: ${recording.events.filter((e) => e.kind === 'click').map((e) => e.text).filter(Boolean).slice(0, 12).join(' | ')}
Inputs the user filled (key, label, example):
${plan.params.map((p) => `- ${p.key} | ${p.label} | ${p.value}`).join('\n') || '- none'}
What it does:
${calls.join('\n')}

Answer with JSON only:
{"description": "one sentence in English saying what the tool does, for an AI agent", "params": {"<key>": {"key": "snake_case English name", "description": "short English description"}}}`
  const data = parseJSON(await complete(cfg, [{ role: 'user', content: prompt }], { json: true, timeoutMs: 90_000 }))
  if (!data) return null
  const used = new Set()
  for (const p of plan.params) {
    const d = data.params?.[p.key]
    if (!d) continue
    let key = slug(d.key || p.key, 'field')
    while (used.has(key)) key += '_2'
    used.add(key)
    for (const a of plan.actions) if (a.param === p.key) a.param = key
    p.key = key
    if (d.description) p.label = String(d.description).slice(0, 120)
  }
  return typeof data.description === 'string' ? data.description.slice(0, 300) : null
}
