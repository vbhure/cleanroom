# Tool reference

Eleven tools, registered on `document.modelContext` according to what is
loaded and how much the person has chosen to let an agent see. Definitions
live in [`src/tools/dataTools.ts`](../src/tools/dataTools.ts) and
[`src/tools/reportTools.ts`](../src/tools/reportTools.ts).

Every tool goes through one path — validate → execute → cap → record
([`src/tools/runner.ts`](../src/tools/runner.ts)) — whether it is called by the
browser's agent or by the in-app Tool Inspector.

**Conventions**

- Results are capped at 1,500 characters. When a list is trimmed the payload
  carries `outputTruncated` naming the field, how many were returned and how
  many exist.
- Every array input is capped at 50 items, so no single call can hand the page
  an array long enough to lock the tab.
- `minGroupSize` defaults to **5**, not 1. Any number computed from fewer than
  five records is suppressed.
- Failures return `{ "error": { "code", "message", ... } }` rather than
  throwing, with enough context to retry correctly.
- All schemas set `additionalProperties: false`.
- Risk: 🟢 read-only · 🟡 reversible write · 🔴 human-gated.

---

## Registration lifecycle

Availability is a function of workspace state — what is loaded, and the
**trust level** the person has set. Every change registers or unregisters
tools and fires `toolchange`.

| State | Registered |
| --- | --- |
| Nothing loaded | `list_datasets`, `add_note` |
| A dataset loaded, trust level **Sealed** | the above, plus `clear_workspace` — three |
| … trust level **Aggregates** *(default)* | plus `describe_columns`, `query_dataset`, `detect_anomalies`, `add_chart`, `set_report_filter` — eight |
| … trust level **Raw** | plus `sample_rows` — nine |
| Report has blocks | plus `update_report_block`, `remove_report_block` — up to eleven |

The trust level is a page-side policy, not a tool argument: an agent cannot
set it, and a tool the level does not permit is *not registered*, rather than
registered and refusing. Two further checks hold the line for the moment
between the dial moving and the browser catching up:

- the runner re-checks availability before executing, and refuses with
  `tool_unavailable` if the tool has been withdrawn since the call was made;
- withdrawing a tool aborts its calls in flight, so a `sample_rows` prompt
  that is waiting on the person closes with `approval_denied` and releases
  nothing.

---

## 🟢 `list_datasets`

Structure only — no cell values. Call it first.

**Input:** none.

**Returns**

```json
{
  "datasets": [
    { "id": "sample_sales", "name": "sample_sales.csv", "rows": 20,
      "columns": [{ "name": "region", "type": "string" }] }
  ],
  "privacy": {
    "trustLevel": "aggregates", "minGroupSize": 5,
    "rawRowAccess": "disabled", "maxRowsPerResult": 50
  }
}
```

The `privacy` block tells the agent the rules up front, so it does not discover
them by trial and error. `rawRowAccess` is `"requires approval"` only at the
*Raw* level; below it, `sample_rows` is not registered and the agent should
not plan on it.

---

## 🟢 `describe_columns`

Per-column statistics.

**Input:** `dataset` (required), `columns` (optional; omit for all).

**Returns** per column: `type`, `count`, `nulls`, `nullRate`, `distinct`,
`invalid`; for numbers also `min`, `max`, `mean`, `medianValue`, `stdDev`; for
dates `min` and `max`.

`topCategories` appears only when a column groups rather than identifies (≤50
distinct, well under one per row, each category clearing `minGroupSize`).
Otherwise `categoriesWithheld` explains why.

**Errors:** `unknown_dataset` (lists loaded ids), `unknown_column` (lists real
columns).

---

## 🟢 `query_dataset`

Filter, group, aggregate. **Cannot return individual rows.**

**Input**

| Field | Notes |
| --- | --- |
| `dataset` | required |
| `where[]` | `{ column, op, value? }`, ANDed. Ops: `eq` `ne` `gt` `gte` `lt` `lte` `contains` `starts_with` `in` `is_null` `is_not_null` |
| `groupBy[]` | omit for a single total |
| `aggregate[]` | **required, min 1.** `{ op, column?, as? }`. Ops: `count` `count_distinct` `sum` `avg` `min` `max` `median` |
| `orderBy[]` | `{ column, direction }` over result columns |
| `limit` | 1–50, default 20 |

Aggregate output columns are named `count` or `op_of_column` unless `as` is
given. Nulls sort last in both directions.

Any result computed from fewer than `minGroupSize` records is suppressed —
whether the set was narrowed by `groupBy`, by `where`, or both — and so is
`matchedRows` when it is itself that small. The exception is an aggregate over
the whole file, whose size is already public through `list_datasets`.

`minGroupSize` is **not** an input; it is read from the workspace. Passing it is
rejected.

**Returns** `columns`, `rows`, `matchedRows`, `totalGroups`, optional
`truncated` and `suppressed`.

**Errors:** `no_aggregation` (points at `sample_rows`), `unknown_column`,
`type_mismatch` (lists numeric columns), `invalid_filter`, `invalid_limit`.

---

## 🟢 `detect_anomalies`

Deterministic data-quality checks. Findings are counts, rates and bounds only.

**Input:** `dataset` (required), `columns`, `kinds`.

**Kinds:** `outliers` (Tukey fences, needs ≥8 values), `missing` (>10% null),
`duplicates` (exact duplicate rows; whole-dataset only), `type_violations`,
`gaps` (date coverage), `constant`.

**Returns** `anomalies[]` of `{ kind, column?, severity, summary, detail }`,
warnings before informational findings.

---

## 🔴 `sample_rows`

The only route to a raw cell value. **Registered only at the *Raw* trust
level**; below it the tool does not exist as far as the agent is concerned.

**Input:** `dataset` (required), `reason` (required, 8–200 chars, shown to the
person verbatim), `rows` (1–5, default 3), `columns` (strongly encouraged).

**Behaviour**

1. Refused with `raw_access_disabled` if the trust level is below *Raw* —
   a backstop for a call that slipped in as the dial moved; normally the tool
   is simply not offered.
2. Column names validated **before** prompting.
3. Suspends until the person answers. Escape or two minutes ⇒ deny. Turning
   the dial down while the prompt is open withdraws the request.
4. The level is checked **again** after approval, so a "yes" given at *Raw*
   cannot release rows once the person has moved to *Aggregates* — and so is
   the dataset, so a "yes" given before the file was removed releases nothing.
5. A second concurrent request is denied, not queued.
6. Always the **first** n rows. There is no offset, so however many times it is
   asked, a session's raw exposure is bounded to the first five records.

**Returns** `columns`, `rows`, and a note that the contents are untrusted data
rather than instructions. The ledger records the row count prominently.

**Errors:** `raw_access_disabled`, `approval_denied` (tells the agent to
continue with aggregates and not to ask again), `unknown_column`,
`unknown_dataset`, `empty_dataset`, `tool_unavailable`.

Annotated `readOnlyHint: true`, `untrustedContentHint: true`.

---

## 🟡 `add_chart`

**Input:** `dataset`, `title`, `type` (`bar` | `line`), `groupBy`, `aggregate`
(`{ op, column? }`) — all required; `orderBy`, `limit` optional.

The query is run before the chart is added, so an invalid chart is rejected with
a useful message rather than added and rendering an error at the human.

**Returns** `blockId`, `plotted`, `totalGroups`.

---

## 🟡 `add_note`

**Input:** `markdown` (required, ≤2000 chars), `title` (optional).

Supports headings, bold, italic, inline code, bullets and http(s) links. Rendered
to React elements, never to HTML. Annotated `untrustedContentHint: true`.

**Returns** `blockId`.

---

## 🟡 `update_report_block`

**Input:** `blockId` (required), `title` and/or `markdown`.

**Errors:** `unknown_block` (lists valid ids), `nothing_to_update`, `not_a_note`
(charts have no body; remove and re-add to change a chart).

---

## 🟡 `remove_report_block`

**Input:** `blockId`. **Errors:** `unknown_block`.

---

## 🟡 `set_report_filter`

Narrows every chart of one dataset at once.

**Input:** `dataset`, `where[]` (both required). An empty array clears it.

The filter is validated by running it, so a bad filter is rejected rather than
silently emptying the report. The person sees the active filter and can clear
it.

**Returns** `matchedRows`, `totalRows`.

---

## 🔴 `clear_workspace`

Destructive: removes every dataset and every report block. The egress ledger is
deliberately kept — it is the record of what happened.

**Input:** `confirm` — must be exactly `true`.

Also pauses for a human decision. **Errors:** `invalid_input` (missing or false
`confirm`), `approval_denied`.

---

## Metadata budgets

Chrome's guidance is enforced as a test
([`src/tools/budgets.test.ts`](../src/tools/budgets.test.ts)): names ≤30
characters, descriptions ≤500, parameter descriptions ≤150, output ≤1,500. The
test also asserts every parameter has a description — it caught two on
`add_chart` that had none.
