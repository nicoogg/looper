# Looper

Show it once, it becomes a tool.

Record yourself doing a task in any web app: a supplier portal, an admin panel, a site with no API.
Looper watches the network traffic behind your clicks, finds the site's own hidden endpoints and writes a small JavaScript file that calls them directly.
Every loop is served as an MCP tool, so an AI agent can repeat the task with new values.

- **No browser at run time.** Loops call the endpoints with `fetch`, so they are fast and do not break when a button moves.
- **The code is yours.** Each loop is a readable file in `loops/`, with no Looper runtime inside it.
- **Your session stays local.** Cookies live in `.looper/session.json` on your machine and never go into the generated code.
- **Clicks as a fallback.** When a site has no usable calls, the loop replays your clicks with Playwright instead.

## Install

```bash
npm install -g looper-mcp
npx playwright install chromium
```

Or run it without installing: `npx looper-mcp <command>`.

## Quick start

Record a task on any site:

```bash
looper record place_order https://portal.example.com/orders
```

To try it on the demo portal in this repo (user `demo`, password `demo`):

```bash
git clone https://github.com/nicoogg/looper && cd looper && npm install
npm run demo
node bin/looper.mjs record place_order http://localhost:5299/orders
```

Log in, place one order, then press Enter in the terminal.
Looper prints what it found:

```
Mode: API (direct calls, no browser)
Inputs: sku (string, "Product code"), qty (number, "Quantity"), note (string, "Delivery note")
  · GET /orders → csrfToken
  · GET /api/me → accountId
  ★ POST /api/accounts/{accountId}/orders
✓ Wrote loops/place_order/loop.mjs
```

Run it with new values:

```bash
node bin/looper.mjs run place_order sku=C-033 qty=5 note="Urgent"
```

## Use it from an agent

```bash
node bin/looper.mjs mcp-config
```

prints the command that adds Looper to Claude Code.
Any MCP client works: the server is `looper serve` over stdio.
New loops show up without a restart.

## Commands

| Command | What it does |
| --- | --- |
| `looper record <name> <url>` | Opens a browser, records the task, writes the loop |
| `looper build <name> [--ai]` | Rebuilds a loop from its saved recording |
| `looper run <name> key=value` | Runs a loop from the terminal |
| `looper list` | Lists your loops and their inputs |
| `looper login <url>` | Logs in again when a session expires |
| `looper serve` | MCP server with every loop as a tool |

`--ai` asks a local model to name the tool and its inputs in plain English.
It uses any OpenAI-compatible endpoint, [Ollama](https://ollama.com) by default (see `.env.example`).

## How it works

1. **Record.** Playwright opens a real browser. Looper keeps what you typed and every request the page made.
2. **Find the action.** The calls that carried your typed values are the action. Login calls are left out, so passwords never reach a loop.
3. **Trace the moving parts.** Every other changing value (CSRF tokens, account ids, bearer tokens) is traced back to the earlier response, cookie or localStorage entry it came from.
4. **Write the loop.** Looper writes those calls as plain `fetch` code with your inputs as parameters.

## Test

```bash
npm test
```

records an order on the demo portal, builds the loop, runs it with new values and calls it through the MCP server.

## Use it responsibly

Record only accounts and sites you are allowed to automate.
Some sites forbid automated access in their terms, and some block it.
Looper never tries to get around a CAPTCHA or a bot check.

## Status

Early.
Works on sites with JSON or form APIs and cookie or token sessions, including third-party APIs a site calls (Algolia, for example).
Tested on the demo portal, Wikipedia search and HN Search.
Not yet: GraphQL-specific handling, multi-factor login refresh, websockets.

MIT licensed.
