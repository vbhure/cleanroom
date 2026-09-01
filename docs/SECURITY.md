# Threat model

Cleanroom's whole proposition is that sensitive data can be analysed by an AI
agent without leaving the browser. That makes the security posture the product,
not a wrapper around it. This document states what is defended, how, and — just
as importantly — what is not.

---

## What we are protecting

The user's file. Specifically: the raw cell values of a spreadsheet the person
was unwilling or unable to upload anywhere.

## Who we are defending against

1. **An over-eager or confused agent** that asks for more than it needs.
2. **Indirect prompt injection** — instructions hidden inside the user's own
   data, or inside a page the agent visited earlier, aimed at making the agent
   exfiltrate records.
3. **Our own future mistakes** — an accidental analytics snippet, a dependency
   that phones home, a logging call that serialises a row.

We are *not* defending against a compromised browser, a malicious extension
with page access, or a user who chooses to release their own data.

---

## Control 1 — the page cannot make a network request

`connect-src 'none'` in the Content-Security-Policy removes `fetch`, `XHR`,
`WebSocket`, `EventSource` and `sendBeacon` from the page. Delivered as an HTTP
header (`netlify.toml`) and embedded in the built markup (`vite.config.ts`), so
it survives a change of host.

This is the strongest control here because it does not depend on our code being
correct. Even if we shipped an exfiltration bug tomorrow, the browser would
block it.

**Verified by:** `e2e/smoke.spec.ts` fires a real cross-origin `fetch` and
asserts it is blocked, and asserts both delivery mechanisms are present.

**It has already cost us something.** Ajv compiles schemas with `new Function`,
which `script-src 'self'` forbids. The choice was to add `unsafe-eval` or to
replace Ajv. We replaced Ajv (`src/tools/schema.ts`). A policy that is never
inconvenient is not doing anything.

---

## Control 2 — no backend exists

There is no server, no database, no API key, no telemetry. The threat surface
of the whole class of server-side vulnerabilities — authentication,
authorisation, injection, IDOR, CSRF, secret management — is absent because
there is no server to attack. This is an architectural decision made for
security reasons, not a convenience.

---

## Control 3 — aggregates by construction, not by convention

`query_dataset` **cannot** return individual rows. Its schema requires at least
one aggregate, and the engine has no raw projection path at all
(`src/data/query.ts`). Without this, an agent could drain a dataset one query at
a time while every individual call looked reasonable.

Profiling is constrained the same way (`src/data/profile.ts`):

- `min`/`max` are computed for numbers and dates only. The minimum of a `name`
  column is a real person's name; the minimum of a `salary` column is a
  statistic.
- Top categories are named only when a column looks categorical rather than
  identifying: at most 50 distinct values, well under one distinct value per
  row, and each category must clear the k-anonymity threshold. Otherwise the
  profile says values were withheld, and why.

Anomaly findings are counts, rates and bounds. **Verified by:** a test asserts
no text cell value can appear in a serialised finding.

---

## Control 4 — k-anonymity the human controls

Grouped results suppress any group smaller than `minGroupSize`. Group by
`email` with the threshold at 5 and you get a suppressed count, not a list of
people.

The threshold lives in the workspace and is read on every call. **An agent
cannot set it.** Passing `minGroupSize` as a tool argument is rejected as an
unexpected property, because every schema sets `additionalProperties: false`.

---

## Control 5 — the human gate is in the app, not the prompt

Two tools suspend execution inside their `execute` until a person answers a
dialog. This is enforced by the application, so no amount of persuasive text
inside a dataset can talk past it — the model is not the thing being asked.

`sample_rows`, the only route to a raw cell value:

- refuses outright unless the human has enabled raw access;
- requires a written `reason`, shown to the human verbatim and attributed to the
  agent, so a reason that is itself an injection attempt reads as exactly that;
- caps the request at 5 rows;
- validates column names *before* prompting, so a person is never asked to
  approve a request that would have failed anyway;
- denies rather than queues if another approval is already pending, so an agent
  cannot bury a dangerous prompt behind a harmless one;
- times out to *deny* after two minutes, and Escape denies — the safe answer is
  always the easy one.

`clear_workspace` additionally requires `confirm: true`, so it cannot be reached
by a malformed call.

---

## Control 6 — untrusted content is treated as data

Notes are rendered by a parser that builds React elements and never touches
`innerHTML` or `dangerouslySetInnerHTML` (`src/ui/Markdown.tsx`). There is no
sink for injected markup to reach, which is stronger than sanitising after the
fact. Links render only for `http`/`https`; a `javascript:` URL renders as inert
text.

Tools returning file-derived content set `untrustedContentHint`, per Chrome's
guidance, so the agent knows to distrust it.

Injected instructions are rendered rather than stripped: hiding them from the
human would hide the attack too.

**Verified by:** injection tests in `src/ui/Markdown.test.tsx` and an E2E test
that asserts an `onerror` payload creates no element and executes nothing.

---

## Control 7 — hostile arguments

- Prototype-polluting keys (`__proto__`, `constructor`, `prototype`) are
  rejected before the schema is consulted, at any nesting depth.
- `additionalProperties: false` at every level of every schema — asserted by a
  test that walks each schema tree.
- A test asserts no tool schema uses a keyword the validator does not implement,
  because a silently unenforced constraint is the worst way for a validator to
  fail.
- Filters are structured values, never strings compiled into anything. There is
  no query language to inject into.
- A tool that throws returns a structured error; exceptions never reach the
  agent as raw rejections.

---

## Control 8 — output budget and the ledger

Every result is capped at 1,500 characters, Chrome's published ceiling. Trimming
is honest: the payload says how many items were dropped so the agent knows it is
looking at a partial answer.

The cap doubles as a rate limiter on how fast a dataset could be drained, and
every character is counted into the egress ledger with its tool, risk class and
row count. Refusals are logged too.

---

## What this does *not* protect against

Stated plainly.

- **Aggregates reach the model.** The file does not; the answers do. The ledger
  exists so this is visible rather than trusted.
- **Repeated narrow queries leak more than one broad one.** The caps, the
  k-anonymity threshold and the visible ledger raise the cost and make probing
  observable. They do not make it impossible.
- **An approved `sample_rows` call really does release records.** That is the
  point of asking. The control is the human, and the ledger records it.
- **A user can turn the guardrails off.** They own their data.
- **Nothing here constrains what the agent does with data after it receives
  it.** No page can.

---

## Dependency posture

Runtime dependencies: React and React DOM. Nothing else. The CSV parser, type
inference, query engine, statistics, JSON Schema validator, markdown renderer,
charts and WebMCP fallback are all first-party and unit-tested.

`npm audit` runs in CI and currently reports 0 vulnerabilities.

---

## Reporting

This is a hackathon project, not a maintained product. If you find a flaw,
please open an issue on the repository.
