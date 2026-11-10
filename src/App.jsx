import { useEffect, useState } from 'react'
import Deck from './components/Deck.jsx'
import LooperChat from './components/LooperChat.jsx'
import { COMMANDS, LOOPS } from './data.js'

const GITHUB = 'https://github.com/nicoogg/looper'

function Lines({ text }) {
  return text.split('\n').map((l, i, all) => (
    <span key={i}>
      {l}
      {i < all.length - 1 && <br />}
    </span>
  ))
}

export function Logo({ size = 26 }) {
  return (
    <a href="#top" className="logo" aria-label="Looper home">
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <path d="M10 16a6 6 0 1 1 6 6h-2" />
        <circle cx="22" cy="16" r="3.4" />
      </svg>
      looper
    </a>
  )
}

function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

const STEPS = [
  ['01', 'Record', 'Hit record and do the task once in a real browser.\nLog in, fill the form, press the button.'],
  ['02', 'Find', 'Looper reads the traffic behind your clicks.\nIt finds the call that did the work and traces every token it needed.'],
  ['03', 'Loop', 'You get a small file of plain fetch code.\nEvery loop is served as an MCP tool your agent can call.'],
]

const CODE = [
  ['c', '// 2. GET /api/me · finds accountId'],
  ['', 'const res2 = await http(ctx, `${BASE}/api/me`)'],
  ['', 'const accountId = need(body2?.account?.id)'],
  ['', ''],
  ['c', '// 3. POST /api/accounts/{accountId}/orders'],
  ['', 'const res3 = await http(ctx, `${BASE}/api/accounts/${accountId}/orders`, {'],
  ['', '  method: "POST",'],
  ['', '  headers: { "x-csrf-token": csrfToken },'],
  ['', '  body: JSON.stringify({'],
  ['v', '    sku: input.sku,'],
  ['v', '    quantity: input.qty,'],
  ['', '    channel: "web",'],
  ['', '  }),'],
  ['', '})'],
]

const FEATURES = [
  ['No browser at run time', 'Loops call the endpoints directly.\nFast, and they keep working when a button moves.'],
  ['Your session stays home', 'Cookies live in .looper/ on your machine.\nPasswords never reach a loop.'],
  ['Code you own', 'One readable file per loop, no runtime inside.\nCommit it, edit it, review it.'],
  ['Any MCP client', 'Claude, Cursor or your own agent.\nNew loops show up without a restart.'],
]

export default function App() {
  const [chat, setChat] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useReveal()

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <div className="app" id="top">
      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <Logo />
        <div className="links">
          <a href="#how">How it works</a>
          <a href="#code">The code</a>
          <a href="#loops">Loops</a>
          <a href="#open">Open source</a>
        </div>
        <a className="btn light small" href={GITHUB}>
          <GitHubIcon /> Star on GitHub
        </a>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="kicker mono">
            <i /> REC · OPEN SOURCE · V0.1
          </p>
          <h1>
            Show it once.
            <br />
            It becomes a tool.
          </h1>
          <p className="sub">
            Record a task in any web app.
            <br />
            Looper finds the hidden API behind it and hands your AI agent a tool that repeats it.
          </p>
          <div className="ctas">
            <a className="btn light" href="#open">
              <span className="mono">npx looper-mcp record</span>
            </a>
            <a className="btn ghost" href="#how">
              How it works <span aria-hidden="true">›</span>
            </a>
          </div>
        </div>
        <Deck />
      </header>

      <main>
        <section className="section" id="how">
          <div className="section-head reveal">
            <p className="eyebrow mono">How it works</p>
            <h2>Three moves.</h2>
          </div>
          <div className="steps">
            {STEPS.map(([n, t, d], i) => (
              <div key={n} className="step reveal" style={{ '--d': `${i * 90}ms` }}>
                <span className="num mono">{n}</span>
                <h3>{t}</h3>
                <p>
                  <Lines text={d} />
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="section split" id="code">
          <div className="section-head reveal">
            <p className="eyebrow mono">The code</p>
            <h2>
              Plain fetch.
              <br />
              Yours to keep.
            </h2>
            <p className="lede">
              The loop is a file in your repo, not a recording on someone's server.
              <br />
              Your inputs become parameters.
              <br />
              Tokens and ids are read from where the site puts them.
            </p>
            <ul className="ticks">
              <li>CSRF tokens, account ids and bearer tokens traced for you</li>
              <li>Clear error when a session expires, with the command to fix it</li>
              <li>Falls back to replaying clicks when a site has no API calls</li>
            </ul>
          </div>
          <div className="editor reveal">
            <div className="editor-bar mono">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              loops/place_order/loop.mjs
            </div>
            <pre className="mono">
              {CODE.map(([k, line], i) => (
                <div key={i} className={`ln ${k}`}>
                  <span className="no">{i + 18}</span>
                  {line || ' '}
                </div>
              ))}
            </pre>
          </div>
        </section>

        <section className="section" id="loops">
          <div className="section-head reveal">
            <p className="eyebrow mono">Loops</p>
            <h2>
              If you can click it,
              <br />
              you can loop it.
            </h2>
            <p className="lede">The tools nobody wrote an API for are where agents get stuck.</p>
          </div>
          <div className="loops">
            {LOOPS.map((l, i) => (
              <article key={l.id} className="loop reveal" style={{ '--d': `${(i % 3) * 80}ms` }}>
                <header>
                  <span className="site">{l.site}</span>
                  <span className={`mode ${l.mode} mono`}>{l.mode === 'api' ? 'API' : 'UI replay'}</span>
                </header>
                <code className="mono">{l.tool}</code>
                <p>
                  <Lines text={l.desc} />
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="open">
          <div className="panel reveal">
            <div>
              <p className="eyebrow mono">Open source</p>
              <h2>
                MIT licensed.
                <br />
                Runs on your machine.
              </h2>
              <p className="lede">
                No account, no cloud, no per-call pricing.
                <br />
                Clone it, run it, change it.
              </p>
            </div>
            <div className="terminal mono">
              {COMMANDS.map(([cmd, what], i) => (
                <div key={cmd} className="term-line" style={{ '--d': `${200 + i * 260}ms` }}>
                  <span className="prompt">$</span> looper {cmd}
                  <span className="what"># {what}</span>
                </div>
              ))}
            </div>
            <div className="features">
              {FEATURES.map(([t, d]) => (
                <div key={t} className="feature">
                  <h4>{t}</h4>
                  <p>
                    <Lines text={d} />
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section final reveal">
          <span className="big-rec" aria-hidden="true" />
          <h2 className="huge">Hit record.</h2>
          <p className="lede center">Star the repo, open an issue, or share a loop you made.</p>
          <div className="ctas center">
            <a className="btn light" href={GITHUB}>
              <GitHubIcon /> View on GitHub
            </a>
            <button className="btn ghost" onClick={() => setChat(true)}>
              Ask Looper <span aria-hidden="true">›</span>
            </button>
          </div>
        </section>
      </main>

      <footer className="footer">
        <Logo size={22} />
        <span>MIT licensed · built in the open</span>
        <span className="dim">© 2026 Looper</span>
      </footer>

      <LooperChat open={chat} setOpen={setChat} />
    </div>
  )
}

function GitHubIcon() {
  return (
    <svg className="gh" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  )
}
