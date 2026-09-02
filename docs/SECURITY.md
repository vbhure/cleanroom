# Threat model

Cleanroom's whole proposition is that an AI agent can be given real power over
data it is never allowed to see. That makes the security posture the product,
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
`WebSocket`, `EventSource` and `sendBeacon` from the page. Two further
directives close channels `connect-src` does not govern: `worker-src 'none'`,
because a worker gets its own policy and a `<meta>` CSP never reaches it, and
`frame-src 'none'`, because a nested document is a second network stack.
Delivered as an HTTP header (`netlify.toml`) and embedded in the built markup
(`vite.config.ts`), so it survives a change of host — and the two copies are
kept in step by a test (`src/security/csp.test.ts`) rather than by memory.

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

## Control 4 — the boundary is a dial the human holds, expressed as tools

The **trust level** — Sealed, Aggregates, Raw — decides which tools are
registered with the browser. At *Sealed*, every tool that computes from the
data is unregistered and the agent is left with `list_datasets`, `add_note`
and `clear_workspace`. At *Aggregates* the analysis tools are offered. Only at
*Raw* does `sample_rows` exist at all.

This is enforced by registration, not by a check inside each tool: an agent
cannot call what it has not been offered, and the browser announces every
change with `toolchange`. Two further checks cover the instant between the
dial moving and the browser catching up — the runner re-checks availability
before executing (`tool_unavailable`), and withdrawing a tool aborts its calls
in flight, so a raw-row prompt waiting on the person closes without releasing
anything.

Both controls live in the workspace and are read on every call. **An agent
cannot set either.** Passing `minGroupSize` or `trustLevel` as a tool argument
is rejected as an unexpected property, because every schema sets
`additionalProperties: false`.

**Verified by:** registry tests assert the exact tool set at each level, that
`toolchange` fires per move and not for a no-op, that a stale handle is dead
after withdrawal, and that a pending prompt is aborted; an end-to-end test
does the same through `document.modelContext` from page context.

---

## Control 5 — no answer is computed from fewer than k records

`minGroupSize` is the k-anonymity threshold, and it **ships at 5 rather than
off**. A privacy control that starts disabled protects the sessions nobody has;
this one is in force in the state every first-time visitor and every judge
meets, and the sample dataset is built for it — four regions of exactly five
rows, so grouping by region is answered and grouping by individual sales rep is
not.

The rule is a query-set-size restriction, and it does not care how the set got
small:

- **Grouping.** Group by `email` and every group below the threshold collapses
  into a suppressed count rather than a list of people.
- **Filtering.** The threshold used to apply only when grouping, on the
  reasoning that "an ungrouped total reveals nothing about any individual".
  That is true of the whole file and false the moment a `where` narrows it:
  filter to one person and `max(salary)` over the remainder *is* that person's
  salary. Any result computed from fewer than k matching rows is suppressed.
- **Subtraction, which is the one that actually bit.** Guarding only the small
  end is not enough, because the whole-file total is always available. An
  answer covering all-but-a-few records is a person in disguise:

  ```
  sum(deal_size)                       over 20 rows -> 616,500
  sum(deal_size) where closed_on != X  over 19 rows -> 341,500
  difference                                        ->  275,000
  ```

  Two individually permitted queries, one person's exact figure, both logged as
  ordinary reads. The threshold therefore holds at **both ends**: a complement
  smaller than k is refused on the same rule as a group smaller than k, and for
  a grouped query both complements are checked — within the matched set and
  within the file — because both totals are obtainable. Found by an adversarial
  review of this project, not in the wild; the regression tests are in
  `src/data/query.test.ts` under "the differencing attack".
- **The count itself.** `matchedRows` is withheld on the same rule. "Exactly
  one record matches this email address" identifies that record as surely as
  returning it would, and so does "no record matches" — the two are the same
  membership disclosure with opposite signs, and above the threshold they are
  indistinguishable to the agent. `set_report_filter` obeys this too; it used
  to probe with the threshold hardcoded to 1.

The single exception is an aggregate over the whole file, which describes the
dataset the person loaded rather than anyone in it, and whose size is already
public through `list_datasets`.

**Verified by:** `src/data/query.test.ts` asserts each path, including that a
filter combined with a grouping cannot walk around it; `src/tools/tools.test.ts`
asserts the threshold is carried into `describe_columns` and `set_report_filter`
and cannot be lowered by an argument on any tool; an end-to-end test drives the
same thing through the UI at the shipped default.

A second guard sits beside it in the profiler. Top categories are named only
when a column groups rows rather than identifying them, and the uniqueness test
divides distinct values by **the rows that actually hold one**, not by every
row. Dividing by every row called a column that is empty in 980 of 1,000 rows
and unique in the other 20 a category.

---

## Control 6 — the human gate is in the app, not the prompt

Two tools suspend execution inside their `execute` until a person answers a
dialog. This is enforced by the application, so no amount of persuasive text
inside a dataset can talk past it — the model is not the thing being asked.

`sample_rows`, the only route to a raw cell value:

- is not registered below the *Raw* trust level, and refuses with
  `raw_access_disabled` — before prompting and again after approval — if the
  level is found to be lower when it runs;
- re-checks after approval that the dataset is still loaded, so a "yes" given
  before the person removed the file does not release rows from it;
- always returns the **first** n rows, never an offset, which bounds the raw
  exposure of a session to the first five records however many times it is
  asked;
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

## Control 7 — untrusted content is treated as data

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

## Control 8 — hostile arguments

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

## Control 9 — output budget and the ledger

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
- **A user can turn the dial to *Raw* and lower the group threshold.** They
  own their data. The controls exist so that doing so is a deliberate act the
  person can see, not a default the agent can rely on.
- **Sealed is not silent.** At the lowest trust level the agent can still call
  `list_datasets`, which returns the file name, the column names, the column
  types and the row count. Column names can themselves be sensitive
  (`hiv_status`, `redundancy_date`). What Sealed guarantees is that nothing is
  *computed from the data*; it is not a claim that the page tells the agent
  nothing.
- **Numeric bounds are real values.** `min`, `max`, `median` on a numeric
  column, and the outlier bounds in `detect_anomalies`, are by construction
  equal to somebody's actual number. That is what a statistic on a numeric
  column is, and it is why the threshold and the ledger exist rather than a
  claim that no value ever escapes. Ordering statistics are refused outright on
  text columns, where the minimum of a `name` column is a person.
- **WebRTC is the one egress channel the policy does not close.** A peer
  connection is not a fetch, so `connect-src` does not govern it; the
  `webrtc 'block'` directive would, but Chromium does not yet recognise it and
  logs a console error for every unrecognised directive. Shipping a policy the
  browser ignores would buy nothing and cost the clean console this project
  asserts in its own smoke test, so the gap is written down here instead. No
  code in Cleanroom opens a peer connection, and there are no runtime
  dependencies beyond React that could.
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
