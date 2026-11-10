import { useCallback, useEffect, useRef, useState } from 'react'
import { LOOPS } from '../data.js'

// Offline fallback, used only when the model endpoint cannot be reached.
function mockReply(input) {
  const q = input.toLowerCase()
  const hit = LOOPS.find((l) => q.includes(l.site.toLowerCase()) || q.includes(l.id.replace(/_/g, ' ')))
  if (hit) return `${hit.site}: \`${hit.tool}\`.\nRecord it with \`looper record ${hit.id} <url>\`.`
  if (/how|work|come/.test(q)) return 'Run `looper record <name> <url>` and do the task once.\nLooper writes the loop and `looper serve` makes it an MCP tool.'
  return 'My model is offline right now.\nStart Ollama and ask me again.'
}

const TOOL_LABEL = {
  list_examples: 'looper.list_examples',
  request_support: 'looper.request_support',
}

// Tiny inline formatter: `code`, **bold**, line breaks.
function Rich({ text }) {
  return text.split('\n').map((line, i, all) => (
    <span key={i}>
      {line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, k) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={k}>{part.slice(1, -1)}</code>
        ) : part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={k}>{part.slice(2, -2)}</strong>
        ) : (
          part
        )
      )}
      {i < all.length - 1 && <br />}
    </span>
  ))
}

const SUGGEST = ['How does it work?', 'Can it handle my login?', 'What if a site has no API?']

export default function LooperChat({ open, setOpen }) {
  const [msgs, setMsgs] = useState([{ k: 'bot', text: 'Hi, I am Looper.\nAsk me how to turn a web task into a tool.' }])
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ state: 'checking' })
  const feed = useRef(null)
  const input = useRef(null)
  const abortRef = useRef(null)

  const checkStatus = useCallback(async () => {
    setStatus({ state: 'checking' })
    try {
      const r = await fetch('/api/looper/status')
      const j = await r.json()
      setStatus(j.online ? { state: 'online', model: j.model } : { state: 'offline', reason: j.reason })
    } catch {
      setStatus({ state: 'offline', reason: 'Looper server not reachable' })
    }
  }, [])

  useEffect(() => {
    if (open && status.state !== 'online') checkStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 250)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => () => abortRef.current?.abort(), [])

  const push = (m) => setMsgs((list) => [...list, m])

  // Append streamed text to the last Looper bubble, or open a new one after a tool row.
  const appendText = (delta) =>
    setMsgs((list) => {
      const last = list[list.length - 1]
      if (last?.k === 'bot' && last.live) return [...list.slice(0, -1), { ...last, text: last.text + delta }]
      return [...list, { k: 'bot', text: delta.replace(/^\s+/, ''), live: true }]
    })

  const send = async (text) => {
    const t = text.trim()
    if (!t || busy) return
    const history = [...msgs, { k: 'user', text: t }]
      .filter((m) => (m.k === 'user' || m.k === 'bot') && m.text.trim())
      .slice(1) // drop the canned greeting
      .map((m) => ({ role: m.k === 'user' ? 'user' : 'assistant', content: m.text }))
    push({ k: 'user', text: t })
    setVal('')
    setBusy(true)

    if (status.state === 'offline') {
      setTimeout(() => {
        push({ k: 'bot', text: mockReply(t) })
        setBusy(false)
      }, 500)
      return
    }

    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch('/api/looper/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Server answered ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          if (!line.trim()) continue
          const e = JSON.parse(line)
          if (e.type === 'text') appendText(e.delta)
          else if (e.type === 'tool')
            push({ k: 'tool', id: e.id, name: TOOL_LABEL[e.name] || e.name, result: null })
          else if (e.type === 'tool_result')
            setMsgs((list) => list.map((m) => (m.k === 'tool' && m.id === e.id ? { ...m, result: e.summary } : m)))
          else if (e.type === 'error') throw new Error(e.message)
        }
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        push({ k: 'bot', text: `Something broke on my side.\n${String(err.message || err).slice(0, 140)}`, error: true })
        checkStatus()
      }
    } finally {
      setMsgs((list) => list.map((m) => (m.live ? { ...m, live: false, text: m.text.trimEnd() } : m)))
      setBusy(false)
      abortRef.current = null
    }
  }

  const last = msgs[msgs.length - 1]
  const waiting = busy && !(last?.k === 'bot' && last.live)
  const statusText =
    status.state === 'online'
      ? `online · ${status.model}`
      : status.state === 'checking'
        ? 'connecting…'
        : 'offline · basic replies'

  return (
    <>
      <button className={`fab ${open ? 'hide' : ''}`} onClick={() => setOpen(true)} aria-label="Ask Looper">
        <span className="fab-rec" />
        Ask Looper
      </button>
      <aside className={`chat glass ${open ? 'open' : ''}`} aria-hidden={!open}>
        <header>
          <span className="avatar big" aria-hidden="true" />
          <div>
            <strong>Looper</strong>
            <small title={status.reason || ''}>
              <span className={`live-dot ${status.state}`} /> {statusText}
            </small>
          </div>
          <button className="close" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </header>
        <div className="chat-feed" ref={feed} aria-live="polite">
          {msgs.map((m, i) =>
            m.k === 'tool' ? (
              <div key={i} className="tool pop">
                <span className="tool-name">→ {m.name}</span>
                <span className={`tool-res ${m.result ? '' : 'pending'}`}>{m.result ? `✓ ${m.result}` : 'running'}</span>
              </div>
            ) : (
              <div key={i} className={`msg ${m.k} pop ${m.error ? 'err' : ''}`}>
                {m.k === 'bot' && <span className="avatar" />}
                <div>
                  <Rich text={m.text} />
                  {m.live && <span className="caret" />}
                </div>
              </div>
            )
          )}
          {waiting && (
            <div className="typing">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        <div className="chips">
          {SUGGEST.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            send(val)
          }}
        >
          <input ref={input} value={val} onChange={(e) => setVal(e.target.value)} placeholder="Ask about Looper" />
          <button type="submit" aria-label="Send" disabled={!val.trim() || busy}>
            ↑
          </button>
        </form>
      </aside>
    </>
  )
}
