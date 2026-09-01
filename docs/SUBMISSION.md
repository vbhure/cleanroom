# Devpost submission package

Prepared, **not submitted**. Every field is ready to paste. Placeholders are
marked `«…»`.

---

## Title

**Cleanroom**

## Tagline

Let ChatGPT analyse your spreadsheet without ever uploading it.

## Links

| Field | Value |
| --- | --- |
| Live URL | `«NETLIFY URL»` |
| Repository | `«GITHUB URL»` |
| Video | `«YOUTUBE URL»` |
| License | MIT, at repository root |

---

## Project description

> Structured so a judge can find each criterion without hunting. The four
> headings below map one-to-one onto the judging criteria.

### The problem

To get AI help with a spreadsheet today, you upload it. Payroll, patient
lists, customer records, unreleased financials — all of it goes to a third
party. Anyone working under a data-egress policy, a client NDA, or basic caution
simply can't do that, so they get no help at all.

Cleanroom removes the upload.

### What it does

Drop a CSV into the page. It is parsed and held **only in your browser tab**.
The page then registers eleven WebMCP tools so an agent can profile, query,
chart and audit that data — while the file itself never leaves your device. A
running **egress ledger** shows you every character the agent has received.

### Why WebMCP is the right fit — *WebMCP Leverage*

**In one sentence: a server-side MCP integration is physically incapable of
doing this, because the data is never on a server.** WebMCP is the only
mechanism by which an agent can compute over data that stays on the user's
device.

Four things make the WebMCP usage non-trivial rather than decorative:

1. **The tool surface is the product's security boundary.** `query_dataset`
   *cannot* return individual rows — its schema requires an aggregate and the
   engine has no raw projection path. The one tool that can reveal a record,
   `sample_rows`, is off by default and suspends inside `execute` until a human
   answers a dialog. The gate is enforced by the application, so no amount of
   persuasive text inside a dataset can talk past it.

2. **Tools appear and disappear with application state, driving `toolchange`.**
   An empty page offers two tools. Loading a dataset makes seven more appear.
   Adding a report block reveals the block-editing tools. The agent's menu
   always describes what the app can actually do right now.

3. **The guardrails belong to the human and cannot be overridden by an
   argument.** The k-anonymity threshold is read from the workspace on every
   call; an agent that passes `minGroupSize` is rejected for an unexpected
   property.

4. **Errors are designed for a model to recover from.** A misspelled column
   returns the real column names; a numeric aggregate on a text column returns
   the list of numeric columns.

### What people and agents can do together that was hard before

The human sets the guardrails and supplies data they were never willing to
upload. The agent explores it, runs statistics it could never do reliably by
reading a rendered table, and builds a report. Charts and notes it creates land
on the same canvas the person edits, badged by author, removable by either.
When the agent needs something genuinely sensitive, the application stops it and
asks — quoting the agent's own stated reason back to the person.

Neither could do this alone: the agent cannot see the file, and the person does
not want to write the queries.

### How it is built — *Execution*

TypeScript, React 19, Vite 8. **No backend, no database, no API key, no
telemetry.** The entire application is static files.

**The containment guarantee is architectural, not a promise.** The app is served
with `connect-src 'none'`, removing the page's ability to make any network
request — `fetch`, `XHR`, `WebSocket`, `EventSource`, `sendBeacon`. It is
delivered both as an HTTP header and embedded in the built markup, so it travels
with the artifact. An end-to-end test fires a real cross-origin `fetch` and
asserts the browser blocks it.

That policy has teeth: it cost us a dependency. Ajv compiles JSON Schemas with
`new Function`, which `script-src 'self'` forbids, and every tool call failed in
the production build. Rather than weaken the policy we replaced Ajv with a
hand-written validator covering exactly the schema subset the tools use.
Cleanroom now has **no runtime dependencies beyond React**.

**423 automated tests** — 368 unit and integration, 55 end-to-end. The E2E suite
drives `document.modelContext.getTools()` and `executeTool()` from page context
without importing our source, so it verifies what an agent actually receives.

### Who it helps — *Potential Impact*

Anyone with a spreadsheet they cannot upload: finance and HR analysts, clinicians,
teachers, small-business owners, journalists working with confidential material,
and everyone at a company with a data-egress policy. Today their options are to
break policy or to go without. This is a third option.

More broadly, it is a worked example of a pattern the agentic web needs: a page
that gives an agent real capability while keeping the authority — over what is
released, and over what cannot be undone — with the person.

### What is new here — *Creativity & Ambition*

The **egress ledger** is, as far as we know, unlike anything else in this space:
a live, itemised account of every byte an agent has received from your data,
including the requests it made and was refused. It turns a privacy claim into an
audit log.

Alongside it: k-anonymity as a user-facing control that the agent provably
cannot override; a profiler that refuses to report `min`/`max` on a text column
because the minimum of a `name` column is a real person's name; and a
`sample_rows` tool that must state its reason in writing, shown to the person
verbatim.

### Honest limitations

The *file* never leaves your browser, but the aggregates the agent computes do.
That is exactly why the ledger exists. Repeated narrow queries leak more than one
broad one; the caps and the visible ledger raise the cost and make probing
observable, they do not make it impossible. This is stated in the README and in
`docs/SECURITY.md` rather than glossed over.

---

## Built with

`typescript` · `react` · `vite` · `webmcp` · `vitest` · `playwright` ·
`netlify` · `web-components-security` · `content-security-policy` ·
`json-schema` · `svg` · `github-actions`

---

## Screenshot checklist

Capture at 1280×800, dark theme, using the sample dataset.

- [ ] **Hero** — report with two agent-authored charts and a note, ledger populated.
- [ ] **The approval modal** — mid-request, agent's reason visible. *The single most important image.*
- [ ] **The egress ledger** — several calls listed, including a refusal, raw rows > 0.
- [ ] **The Tool Inspector** — `query_dataset` selected, schema expanded.
- [ ] **The guardrails** — left rail, minimum group size set to 5, raw access off.
- [ ] **DevTools proof** — Network tab or CSP header showing `connect-src 'none'`.

## Video checklist

- [ ] Under 3:00 (target 2:45)
- [ ] Audio narration explaining the project and its WebMCP usage
- [ ] Public on YouTube, link live before the deadline
- [ ] No copyrighted music, no third-party trademarks
- [ ] Shows a real tool call and a real approval prompt
- [ ] English

---

## Compliance matrix

| Requirement | Status | Evidence | Action needed |
| --- | --- | --- | --- |
| Age of majority in country of residence | ✅ | Confirmed by entrant | — |
| Resident of an eligible country (India not excluded) | ✅ | Confirmed by entrant | — |
| Solo entry permitted | ✅ | Official rules | — |
| WebMCP-powered web app | ✅ | 11 tools on `document.modelContext`; `src/tools/` | — |
| Built during submission window (from 25 Aug 2026) | ✅ | 8 commits, all dated 1 Sep 2026 | — |
| Functions consistently on its platform | ✅ | 55 E2E tests across 4 viewports; 3 browser modes | Re-verify on live URL |
| Public code repository | 🔴 | 8 commits on local `main`, clean tree | **Push to GitHub** |
| Open-source license visible at repo root | ✅ | `LICENSE` (MIT), committed first | Verify visible in About |
| Complete source + run instructions | ✅ | README: install, verify, build, deploy | — |
| Documented tool registration in repo | ✅ | `src/tools/registry.ts`, `docs/TOOLS.md` | — |
| Working live URL | 🔴 | Build verified; `netlify.toml` committed | **Deploy to Netlify** |
| Reachable in ChatGPT browser or Chrome 149+ | ⚠️ | Imperative API only; no iframes, no declarative forms — both unsupported by ChatGPT's browser | Verify on live URL |
| Free judge access through judging period | ✅ | No auth, no paywall, no account | — |
| Text description: why WebMCP fits | ✅ | This document | Paste into Devpost |
| Text description: how it improves UX | ✅ | This document | Paste into Devpost |
| Text description: human + agent collaboration | ✅ | This document | Paste into Devpost |
| Text description: implementation approach | ✅ | This document | Paste into Devpost |
| Demo video ≤ 3 minutes, with audio | 🔴 | Script in `docs/DEMO.md` | **Record and upload** |
| Video public on YouTube | 🔴 | — | **Upload, set public** |
| No copyrighted music or third-party marks | ⚠️ | Script specifies none | Honour when recording |
| English language | ✅ | All materials | — |
| Third-party terms respected | ✅ | Only React (MIT) at runtime | — |
| Original work, solely owned | ✅ | All first-party; no vendored code | — |
| Submitted before 3 Sep 2026, 1:00 PM PT | 🔴 | — | **Submit** |

**Legend:** ✅ done with evidence · ⚠️ done but needs confirmation on the live
deployment · 🔴 outstanding.

Four items are outstanding and three of them are a single unblock away: push,
deploy, record, submit.
