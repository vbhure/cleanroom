# Cleanroom

**Analyse a spreadsheet with an AI agent without ever uploading it.**

Cleanroom is a local-first analysis workspace built for the
[WebMCP Challenge](https://webmcp.devpost.com/). You drop a CSV into the page;
it is parsed and held **only in your browser tab**. The page then registers a
suite of [WebMCP](https://github.com/webmachinelearning/webmcp) tools so an AI
agent can profile, query and chart that data — while the file itself never
leaves your device.

> **Why WebMCP is essential here, in one sentence:** a server-side MCP
> integration is *physically incapable* of doing this, because the data is never
> on a server. WebMCP is the only mechanism by which an agent can compute over
> data that never leaves the user's device.

---

## Status

🚧 **In active development for the WebMCP Challenge** (submission deadline
3 September 2026). This README is updated as milestones land.

| Milestone | State |
| --- | --- |
| Project setup, CI, containment guarantee | ✅ Done |
| Dataset ingest + query engine | ⏳ In progress |
| WebMCP tool layer | ⏳ Planned |
| Egress ledger + human approval gate | ⏳ Planned |
| Tool Inspector | ⏳ Planned |
| Production deployment | ⏳ Planned |

---

## The containment guarantee

Cleanroom's privacy claim is not a promise — it is enforced by the browser and
verifiable by anyone in five seconds.

The app ships with a Content-Security-Policy containing **`connect-src 'none'`**,
which removes the page's ability to make *any* network request: `fetch`, `XHR`,
`WebSocket`, `EventSource`, `sendBeacon`. It is delivered twice, as an HTTP
header ([`netlify.toml`](./netlify.toml)) and embedded in the built markup
([`vite.config.ts`](./vite.config.ts)), so the guarantee travels with the
artifact regardless of where it is hosted.

There is **no backend, no database, no API key and no telemetry**. The entire
application is static files.

This is covered by an automated end-to-end test that attempts a real network
request from page context and asserts that the browser blocks it — see
[`e2e/smoke.spec.ts`](./e2e/smoke.spec.ts).

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

### Verification

```bash
npm run verify       # lint + typecheck + unit tests + production build
npm run test         # unit and integration tests (Vitest)
npm run test:coverage
npm run e2e          # end-to-end tests against the production build (Playwright)
```

`npm run e2e` requires browsers once: `npx playwright install chromium`.

### Production build

```bash
npm run build        # -> dist/
npm run preview      # serves dist/ with the production security headers
```

---

## Testing this as a judge

Cleanroom works in three environments, in descending order of fidelity:

1. **ChatGPT Desktop's in-app browser** — WebMCP is supported natively. Requires
   a recent desktop app build and a model with site tools enabled.
2. **Chrome 149+ or Edge 150+** — enable
   `chrome://flags/#enable-webmcp-testing`, or rely on the origin trial token
   served with the deployed site.
3. **Any other browser** — Cleanroom installs the official Apache-2.0 WebMCP
   reference polyfill and exposes an in-app **Tool Inspector**, so every tool
   remains discoverable and callable with its real schema and real results. The
   header pill tells you which mode you are in.

---

## Architecture

```
Browser tab (the entire application — there is no server)
├── Dataset store       in-memory only, never serialised to the network
├── Query/stats engine  pure TypeScript, zero dependencies, unit tested
├── Tool layer          validate → gate → execute → cap output → log egress
│      └── document.modelContext.registerTool()
├── Report canvas       shared surface humans and agents both edit
└── Egress ledger       every byte an agent has received, itemised
```

See [`docs/`](./docs) for the architecture notes, threat model and tool
reference.

---

## Tech

TypeScript · React 19 · Vite 8 · Vitest · Playwright · WebMCP. No backend, no
runtime dependencies beyond React and Ajv (JSON Schema validation).

---

## License

[MIT](./LICENSE) © 2026
