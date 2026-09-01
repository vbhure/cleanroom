# Cleanroom

[![CI](https://github.com/vbhure/cleanroom/actions/workflows/ci.yml/badge.svg)](https://github.com/vbhure/cleanroom/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Give an AI agent real power over data it is never allowed to see.**

Cleanroom is a zero-backend analysis workspace built for the
[WebMCP Challenge](https://webmcp.devpost.com/). You drop a CSV into the page;
it is parsed and held **only in your browser tab**, on a page that cannot make
a network request. The page then registers up to eleven
[WebMCP](https://github.com/webmachinelearning/webmcp) tools so an AI agent can
profile, query, chart and audit that data — while the file itself never leaves
your device, and never reaches the agent.

The data cannot go to the agent, so the tools go to the data. And the tools are
the privacy boundary: **you set a trust level, and the agent's menu changes in
front of you** — down to three tools at *Sealed*, up to the one human-gated
raw-row tool at *Raw*. Every byte that does leave is counted on a ledger:
*X MB kept local · Y KB released.*

> **Why WebMCP is essential here, in one sentence:** a server-side MCP
> integration is *physically incapable* of doing this, because the data is never
> on a server. WebMCP is the only mechanism by which an agent can compute over
> data that never leaves the user's device — and the only one where the page
> itself decides, live, which capabilities the agent is offered.

---

## The problem

To get AI help with a spreadsheet today, you upload it. Payroll, patient lists,
customer records, unreleased financials — all of it goes to a third party. Most
people working with sensitive data simply can't do that, so they get no help at
all. The alternative, an agent clicking around a BI tool by screenshot, is slow,
brittle, and cannot do statistics.

The tension is real: an agent is only useful if it has real power over the
data, and the data is only safe if the agent never sees it. Cleanroom resolves
it by moving the computation to the data instead of the data to the model. The
agent gets structured tools that run in your tab and return aggregates; the
file stays put; you decide how much power the agent has, and you can see
exactly what it received.

---

## The containment guarantee

Cleanroom's privacy claim is not a promise. It is enforced by the browser and
verifiable by anyone in about five seconds.

The app is served with a Content-Security-Policy containing
**`connect-src 'none'`**, which removes the page's ability to make *any* network
request: `fetch`, `XHR`, `WebSocket`, `EventSource`, `sendBeacon`. It is
delivered twice — as an HTTP header ([`netlify.toml`](./netlify.toml)) and
embedded into the built markup by a Vite plugin ([`vite.config.ts`](./vite.config.ts))
— so the guarantee travels with the artifact regardless of where it is hosted.

There is **no backend, no database, no API key, no telemetry and no analytics**.
The entire application is static files.

Two automated tests hold this in place: one asserts the policy is served, and
one fires a real cross-origin `fetch` from page context and asserts the browser
blocks it. See [`e2e/smoke.spec.ts`](./e2e/smoke.spec.ts).

**This constraint has teeth.** It forced a real change: Ajv, the JSON Schema
validator, compiles schemas with `new Function`, which `script-src 'self'`
blocks. Rather than weaken the policy, the validator was replaced with a
hand-written one covering exactly the schema subset the tools use. Cleanroom now
has no runtime dependencies beyond React.

---

## What an agent can do here that it could not through an ordinary page

| | Ordinary web page | Cleanroom via WebMCP |
| --- | --- | --- |
| Read the data | Upload it, or scrape pixels | Never sees the file; receives capped aggregates |
| Compute statistics | Guesses from a rendered table | Calls a deterministic engine and gets exact numbers |
| Find outliers | Eyeballs numbers, unreliably | `detect_anomalies` runs Tukey fences and returns findings |
| Know what it may do | Infers from the UI | `list_datasets` returns the privacy limits in force |
| Recover from a mistake | Retries blindly | Errors name the real columns, so it self-corrects |
| Do something risky | Whatever the UI allows | Blocked in the app until a human clicks |
| Have its power reduced | Not possible mid-session | Turn the trust dial: tools are unregistered live |
| Be held to account | No record | Every call itemised in the egress ledger |

---

## The eleven tools

Full reference: [`docs/TOOLS.md`](./docs/TOOLS.md).

**Read-only** — return aggregates only, never a cell value:

| Tool | What it does |
| --- | --- |
| `list_datasets` | Structure, row counts, column types, and the privacy limits in force |
| `describe_columns` | Per-column statistics; categories named only when a column groups rather than identifies |
| `query_dataset` | Filter, group and aggregate. **Cannot return individual rows.** |
| `detect_anomalies` | Outliers, missing values, duplicates, type violations, date gaps, constant columns |

**Reversible writes** — edit the report the human is looking at:

| Tool | What it does |
| --- | --- |
| `add_chart` | Adds a bar or line chart, validated before it is added |
| `add_note` | Adds a markdown note |
| `update_report_block` | Revises a title or note body |
| `remove_report_block` | Deletes one block |
| `set_report_filter` | Narrows every chart of a dataset at once |

**Human-gated** — suspend inside `execute` until a person decides:

| Tool | What it does |
| --- | --- |
| `sample_rows` | The *only* route to a raw cell value. Not even registered below the *Raw* trust level; needs a written reason shown to the person verbatim; asks every time. |
| `clear_workspace` | Destructive. Needs an explicit `confirm` flag **and** a human decision. |

### Tools appear and disappear with the app's state

Registration is driven by workspace state, firing `toolchange`. On an empty
page an agent is offered two tools. Load a dataset and six more appear. Add a
report block and the block-editing tools appear. The menu always describes what
the app can actually do right now, so an agent never proposes an action that
cannot work.

### The privacy boundary is a dial, and it changes the agent's tools

The left rail has a three-position **trust level**. It is not a preference the
tools consult; it decides which tools are registered with the browser at all.

| Level | What the agent is offered | What can leave the tab |
| --- | --- | --- |
| **Sealed** | `list_datasets`, `add_note`, `clear_workspace` — 3 tools | Nothing derived from the data |
| **Aggregates** *(default)* | + `describe_columns`, `query_dataset`, `detect_anomalies`, `add_chart`, `set_report_filter` — 8 tools | Aggregates only, under `minGroupSize` |
| **Raw** | + `sample_rows` — 9 tools | Up to 5 rows, each request approved by you |

Move the dial and the tools are registered or unregistered on the spot,
through the same `toolchange` path that tracks datasets and report blocks. An
agent watching `toolchange` sees its menu shrink or grow; the Tool Inspector
shows the count change; `list_datasets` reports the level in force. A call that
arrives in the moment between the dial moving and the tool being withdrawn is
refused by the runner (`tool_unavailable`), and a `sample_rows` request already
waiting on your decision is withdrawn with the tool.

### The human owns the boundary

The trust level and `minGroupSize` (k-anonymity) are read from the workspace on
every call and **cannot be set by a tool argument**. An agent that tries to pass
`minGroupSize` or `trustLevel` is rejected for an unexpected property.

`minGroupSize` ships at **5, not off**: a privacy control that starts disabled
protects the sessions nobody has. Any answer computed from fewer than five
records is suppressed, however the set got small — by grouping, by filtering,
or by asking how many rows matched. Load the sample and ask for revenue by
sales rep and you get nothing back, because no rep closed five deals; ask by
region and you get all four, because each region has exactly five. That is the
threshold doing its job, in the state you first meet the page in.

---

## The report is one canvas, with two authors

Everything either side creates lands on the same surface, and each block is
badged with who made it. The agent adds charts and notes through `add_chart`
and `add_note`; the person writes their own notes, edits the agent's wording in
place, and removes either. Editing does not launder the authorship — a note the
agent started still says *Added by agent* after you have rewritten it, because
that is the honest record.

There is no second, human-only code path: `update_report_block` and the Edit
button call the same store method, and every chart recomputes from the local
data on render, so changing the report filter or the group-size threshold
updates the agent's charts and yours together.

## The egress ledger

One line sums it up — **`955 B kept local · 1.2 KB released`** — the bytes of
source data held in this tab against the bytes of tool output that have ever
left it. Below that, every tool call is itemised: risk class, characters the
agent received, raw rows released, and whether the output was truncated.
Refusals are listed too — seeing that an agent asked for something and was
turned down is as informative as seeing what it got.

It turns "your data stays local" from a claim into a running account you can
audit at a glance.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

### Verification

```bash
npm run verify       # lint + typecheck + unit tests + production build
npm run test         # 433 unit and integration tests (Vitest)
npm run test:coverage
npm run e2e          # 68 end-to-end tests against the production build
```

`npm run e2e` needs browsers once: `npx playwright install chromium`.

### Production build

```bash
npm run build        # -> dist/
npm run preview      # serves dist/ with the production security headers
```

---

## Testing this as a judge

Cleanroom works in three environments, in descending order of fidelity. The
header pill tells you which one you are in.

1. **ChatGPT Desktop's in-app browser** — WebMCP is supported natively, so
   ChatGPT itself can discover and call the tools. Requires a recent desktop
   build with site tools available.
2. **Chrome 149+ or Edge 150+** — enable `chrome://flags/#enable-webmcp-testing`
   and reload. The browser's agent sees the tools natively.
3. **Any other browser** — Cleanroom installs its own minimal implementation of
   the WebMCP interface and shows a banner saying so. An outside agent cannot
   reach the tools, but the built-in **Tool Inspector** discovers them with
   `getTools()` and calls them with `executeTool()` — the same two calls an
   agent makes. Every schema, annotation, error and result is identical.

**A two-minute tour, in any browser:**

1. Press **Load the sample dataset**. The ledger on the right now reads
   *955 B kept local · 0 B released*, and the left rail says **8 of 11 tools
   registered for the agent right now**.
2. Open the **Tool Inspector** at the bottom. It went from *2 of 11* to *8 of
   11*, and `sample_rows` is not among them.
3. Select `query_dataset`, press **Call** with the example arguments. Aggregates
   come back; the ledger records exactly how many bytes the agent received.
   Now change `groupBy` to `["rep"]` and call again — **nothing comes back**.
   No sales rep closed five deals, and the threshold is five.
4. In the left rail, set the trust level to **Sealed**. The Inspector drops to
   *3 of 11*: the agent can no longer compute anything from your data.
5. Set it to **Raw**. *9 of 11*, and `sample_rows` has appeared. Call it. The
   app stops and asks you, quoting the agent's stated reason. Press **Don't
   allow**.
6. Call it once more and press **Allow this once**. Watch the **raw rows**
   counter in the ledger go from 0 to 2, and the released bytes tick up.

---

## Architecture

```
Browser tab — the entire application. There is no server.
├── Dataset store       in-memory only, never serialised to the network
├── Query/stats engine  pure TypeScript, zero dependencies, unit tested
├── Trust dial          decides which tools are registered at all
├── Tool layer          validate → gate → execute → cap output → log egress
│      └── document.modelContext.registerTool() / toolchange
├── Report canvas       shared surface; agent and human blocks are the same
└── Egress ledger       every character an agent has received, itemised
```

One execution path serves both consumers — the browser's agent and the Tool
Inspector — so there is no laxer route for either.

```
src/
  data/      CSV parsing, type inference, query engine, profiling, anomalies
  state/     the workspace store (datasets, report, trust level, ledger)
  tools/     tool definitions, JSON Schema validator, runner, WebMCP registrar
  ui/        report canvas, charts, sidebar, ledger, approval modal, inspector
  webmcp/    spec types, environment detection, local fallback implementation
```

Further reading: [`docs/SECURITY.md`](./docs/SECURITY.md) for the threat model,
[`docs/TOOLS.md`](./docs/TOOLS.md) for the tool reference.

---

## Deployment

Static hosting, no environment variables, no secrets.

```bash
npm run build   # publish dist/
```

`netlify.toml` is committed with the build command, publish directory and the
security headers. Importing this repository into Netlify needs no additional
configuration.

---

## Limitations

Stated plainly, because a tool that overstates what it guarantees is worse than
one that does less.

- **Aggregates do reach the model.** The *file* never leaves your browser, but
  the answers derived from it do. That is the point of the ledger: so you can
  see exactly what left, rather than being asked to trust a claim.
- **A determined agent could still probe.** Repeated narrow queries leak more
  than one broad one. `minGroupSize`, the row and character caps, and the ledger
  raise the cost and make it visible; they do not make it impossible.
- **Numeric bounds are real values.** `min`, `max` and `median` on a numeric
  column are by construction somebody's actual number. That is what a statistic
  on a numeric column is. They are refused outright on text columns, where the
  minimum of a `name` column is a person.
- **Sealed still names things.** At the lowest trust level `list_datasets` still
  returns the file name, the column names and the row count. Sealed guarantees
  nothing is *computed from* your data, not that the page says nothing.
- **`sample_rows` has no offset.** It returns the first n rows, always, so the
  raw exposure of a session is bounded to the first five records however often
  it is asked.
- **Files above 25 MB are refused** at the drop zone, before parsing.
- **Date parsing is deliberately strict.** ISO-like formats only. `03/04/2026`
  is ambiguous between two continents, so it stays text rather than being
  guessed at.
- **Percentages are not parsed as numbers**, because `50%` could mean 50 or 0.5
  and guessing would corrupt every average computed from it.
- **100,000 rows** are loaded, then the file is truncated with a warning, to
  keep the tab responsive.
- **Charts are bar and line only.** Two shapes done properly.
- **Tools are same-origin.** `exposedTo` is deliberately left unset.
- **The tools live in the top-level page.** ChatGPT's browser does not support
  the declarative form API or tools registered in iframes, so neither is used.

---

## License

[MIT](./LICENSE)
