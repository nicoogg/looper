import { useEffect, useMemo, useRef, useState } from 'react'

// The loop pedal: the requests of one recording drawn as a waveform.
// The playhead sweeps it, the dependencies light up amber, the action lights up red.
const BARS = 72
const DEPS = { 16: 'csrf', 27: 'me' }
const CORE = 53

const STEPS = [
  { at: 16, key: 'csrf', method: 'GET', path: '/orders', note: '→ csrfToken', kind: 'dep' },
  { at: 27, key: 'me', method: 'GET', path: '/api/me', note: '→ accountId', kind: 'dep' },
  { at: CORE, key: 'core', method: 'POST', path: '/api/accounts/{accountId}/orders', note: '★ the action · sku, qty, note', kind: 'core' },
]

function height(i) {
  if (i === CORE) return 100
  if (DEPS[i]) return 72
  return 10 + Math.abs(Math.sin(i * 1.73) * 34) + ((i * 7) % 11) * 2.4
}

export default function Deck() {
  const [pos, setPos] = useState(0)
  const [visible, setVisible] = useState(true)
  const ref = useRef(null)
  const bars = useMemo(() => Array.from({ length: BARS }, (_, i) => height(i)), [])

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPos(BARS + 10)
      return
    }
    let raf
    let start
    const loop = (t) => {
      start ??= t
      // one sweep in 6 s, then a short hold before the loop restarts
      const p = (((t - start) / 6000) % 1.25) * BARS
      setPos(p)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [visible])

  const found = (i) => pos >= i
  const done = pos >= BARS

  return (
    <div className="deck" ref={ref}>
      <div className="deck-head">
        <span className="mono dim">
          TRACK 01 · portal.supplier.com · {BARS} requests
        </span>
        <div className="knobs" aria-hidden="true">
          <span className="knob" style={{ '--r': '-40deg' }} />
          <span className="knob" style={{ '--r': '25deg' }} />
          <span className={`rec ${done ? '' : 'on'}`} />
        </div>
      </div>

      <div className="wave" aria-hidden="true">
        {bars.map((h, i) => (
          <span
            key={i}
            className={`bar ${i === CORE ? 'core' : DEPS[i] ? 'dep' : ''} ${found(i) ? 'lit' : ''}`}
            style={{ height: `${h}%` }}
          />
        ))}
        <span className="head" style={{ left: `${Math.min(pos, BARS) / BARS * 100}%`, opacity: done ? 0 : 1 }} />
      </div>

      <div className="labels">
        {STEPS.map((s) => (
          <div key={s.key} className={`lab ${s.kind} ${found(s.at) ? 'in' : ''}`}>
            <b className="mono">
              {s.method} {s.path}
            </b>
            <span className="mono">{s.note}</span>
          </div>
        ))}
      </div>

      <div className={`deck-out mono ${done ? 'in' : ''}`}>
        <span>loops/place_order/loop.mjs · no browser at run time</span>
        <em>● served over MCP</em>
      </div>
    </div>
  )
}
