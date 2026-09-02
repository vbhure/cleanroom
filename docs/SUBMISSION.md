# Devpost submission package

Prepared, **not submitted**. Every field is ready to paste. Placeholders are
marked `«…»`.

---

## Title

**Cleanroom**

## Tagline

A capability firewall for AI agents. Close a port and the agent's tool stops
existing — not refused, unregistered.

## Links

| Field | Value |
| --- | --- |
| Live URL | https://frabjous-squirrel-07823a.netlify.app |
| Repository | https://github.com/vbhure/cleanroom |
| Video | https://youtu.be/egnjFYz8zsM |
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

The tension is that an agent is only useful if it has real power over the
data, and the data is only safe if the agent never sees it. Cleanroom is built
on the resolution: the data cannot go to the agent, so the tools go to the data.

### What it does

**Cleanroom is a capability firewall for AI agents.** The spreadsheet is the
worked example.

Every firewall in history has worked the same way: you do not ask the traffic
politely to stay out, you close the port. Agent permission systems have not
caught up — they let the tool exist and make it refuse. A refusal is a
conversation, and a conversation can be argued with.

Cleanroom closes the port. A three-position **trust dial** decides which WebMCP
tools are *registered with the browser at all*. Move it and tools are
unregistered live, `toolchange` fires, and an agent holding a handle it
discovered thirty seconds ago gets this from the interface itself:

```
NotFoundError: No tool named "sample_rows" is registered.
```

Not a policy error from our code. The browser saying the capability does not
exist. **A firewall you cannot argue with, because there is nothing to argue
with.**

The worked example is a spreadsheet. Drop a CSV in; it is parsed and held only
in your browser tab, on a page served with `connect-src 'none'` so it cannot
make a network request of any kind. Up to eleven WebMCP tools let an agent
profile, query, chart and audit that data — while the file itself never leaves
your device and never reaches the agent.

The tools *are* the privacy boundary. A three-position **trust level** —
Sealed, Aggregates, Raw — decides which tools are registered with the browser
at all, and moving it changes the agent's menu in front of you. A running
**egress ledger** keeps the balance in one line — *955 B kept local · 1.2 KB
released* — and itemises every call beneath it.

### Why WebMCP is the right fit — *WebMCP Leverage*

**In one sentence: a server-side MCP integration is physically incapable of
doing this, because the data is never on a server.** WebMCP is the only
mechanism by which an agent can compute over data that stays on the user's
device.

Four things make the WebMCP usage non-trivial rather than decorative:

1. **The tool surface is the product's privacy boundary, and the person sets
   it.** `query_dataset` *cannot* return individual rows — its schema requires
   an aggregate and the engine has no raw projection path. The one tool that
   can reveal a record, `sample_rows`, is not registered at all until the
   person turns the trust dial to *Raw*, and even then it suspends inside
   `execute` until a human answers a dialog. At *Sealed*, every tool that
   computes from the data is withdrawn and the agent is left with three. The
   gate is enforced by the application, so no amount of persuasive text inside
   a dataset can talk past it.

2. **Capabilities are registered and withdrawn live, driving `toolchange`.**
   An empty page offers two tools. Loading a dataset makes six more appear.
   Turning the dial to *Sealed* takes five away; turning it to *Raw* adds one.
   Adding a report block reveals the block-editing tools. The agent's menu
   always describes what the app can actually do right now — and what the
   person is currently willing to let it do.

3. **The boundary cannot be moved by an argument.** The trust level and the
   k-anonymity threshold are read from the workspace on every call; an agent
   that passes `minGroupSize` or `trustLevel` is rejected for an unexpected
   property. The threshold ships at 5 rather than off, and applies to any
   answer computed from fewer than five records however the set got small —
   by grouping, by filtering, or by asking how many rows matched. A call that arrives after the dial moved but before the tool was
   withdrawn is refused by the runner; a raw-row request already waiting on
   the person is withdrawn with the tool.

4. **Errors are designed for a model to recover from.** A misspelled column
   returns the real column names; a numeric aggregate on a text column returns
   the list of numeric columns; a withdrawn tool tells the agent to call
   `list_datasets`, which reports the level in force.

### What people and agents can do together that was hard before

The person supplies data they were never willing to upload and decides, with
one control, how much power the agent has over it. The agent explores it, runs
statistics it could never do reliably by reading a rendered table, and builds
a report.

**The canvas is genuinely two-sided.** Charts and notes the agent creates land
on the same surface the person writes on, each block badged with who made it.
The person can write their own notes, edit the agent's wording in place, and
remove either — and editing does not launder the authorship, so the badge stays
honest. An agent's `update_report_block` and a person's Edit button are the same
operation on the same store.

When the agent needs something genuinely sensitive, the application stops it and
asks — quoting the agent's own stated reason back to the person — and the person
can change their mind mid-session by turning the dial, which the agent sees as
its own tools changing.

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

**529 automated tests** — 460 unit and integration, 69 end-to-end. The E2E suite
drives `document.modelContext.getTools()` and `executeTool()` from page context
without importing our source, so it verifies what an agent actually receives —
including that a tool handle captured at *Raw* is dead once the dial comes down,
and that the browser reports a `securitypolicyviolation` rather than merely
throwing when the page attempts to reach the network.

### Who it helps — *Potential Impact*

Anyone with a spreadsheet they cannot upload: finance and HR analysts, clinicians,
teachers, small-business owners, journalists working with confidential material,
and everyone at a company with a data-egress policy. Today their options are to
break policy or to go without. This is a third option.

More broadly, it is a worked example of a pattern the agentic web needs: a page
that gives an agent real capability while keeping the authority — over what is
released, how much, and what cannot be undone — with the person, and expresses
that authority as the set of tools the agent is offered.

### What is new here — *Creativity & Ambition*

**The trust dial treats WebMCP registration as a policy surface.** Instead of
a tool that consults a setting and refuses, the setting decides whether the
tool exists. An agent cannot ask for what it has not been offered, and the
person can watch the offer change.

The **egress ledger** is, as far as we know, unlike anything else in this space:
a live account of every byte an agent has received from your data, summed
against the bytes that never left — *kept local · released* — and itemised
beneath, including the requests it made and was refused. It turns a privacy
claim into an audit log.

Alongside them: k-anonymity as a user-facing control that the agent provably
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
- [ ] **The privacy boundary** — left rail with the trust level at *Sealed*, Inspector showing 3 tools; a second frame at *Raw* showing 9.
- [ ] **The balance line** — ledger header reading `955 B kept local · … released` after a few calls.
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
| WebMCP-powered web app | ✅ | 11 tools on `document.modelContext`, registered and withdrawn by trust level; `src/tools/` | — |
| Built during submission window (from 25 Aug 2026) | ✅ | 9 public commits, all dated 1 Sep 2026 | — |
| Functions consistently on its platform | ✅ | 69 E2E tests, 13 of them across 4 viewports; CI green on clean Ubuntu runner | Re-verify on live URL and in CI after the next push |
| Public code repository | ✅ | https://github.com/vbhure/cleanroom — public, 9 commits | — |
| Open-source license visible at repo root | ✅ | `LICENSE` (MIT); GitHub API reports `spdx_id: MIT` | — |
| Complete source + run instructions | ✅ | README: install, verify, build, deploy; CI proves a clean clone builds and passes | — |
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

Three items are outstanding: deploy, record the video, submit.
