# Tool reference

Eleven tools, registered on `document.modelContext`. Definitions live in
[`src/tools/dataTools.ts`](../src/tools/dataTools.ts) and
[`src/tools/reportTools.ts`](../src/tools/reportTools.ts).

Every tool goes through one path — validate → execute → cap → record
([`src/tools/runner.ts`](../src/tools/runner.ts)) — whether it is called by the
browser's agent or by the in-app Tool Inspector.

**Conventions**

- Results are capped at 1,500 characters. When a list is trimmed the payload
  carries `outputTruncated` naming the field, how many were returned and how
  many exist.
- Failures return `{ "error": { "code", "message", ... } }` rather than
  throwing, with enough context to retry correctly.
- All schemas set `additionalProperties: false`.
- Risk: 🟢 read-only · 🟡 reversible write · 🔴 human-gated.

---

## Registration lifecycle

Availability is a function of workspace state; changes fire `toolchange`.

| State | Registered |
| --- | --- |
| Nothing loaded | `list_datasets`, `add_note` |
| A dataset loaded | the above, plus `describe_columns`, `query_dataset`, `detect_anomalies`, `sample_rows`, `add_chart`, `set_report_filter`, `clear_workspace` — nine in total |
| Report has blocks | plus `update_report_block`, `remove_report_block` — eleven |

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
  "privacy": { "minGroupSize": 1, "rawRowAccess": "disabled", "maxRowsPerResult": 50 }
}
```

The `privacy` block tells the agent the rules up front, so it does not discover
them by trial and error.

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

The only route to a raw cell value.

**Input:** `dataset` (required), `reason` (required, 8–200 chars, shown to the
person verbatim), `rows` (1–5, default 3), `columns` (strongly encouraged).

**Behaviour**

1. Refused with `raw_access_disabled` unless the human enabled raw access.
2. Column names validated **before** prompting.
3. Suspends until the person answers. Escape or two minutes ⇒ deny.
4. A second concurrent request is denied, not queued.

**Returns** `columns`, `rows`, and a note that the contents are untrusted data
rather than instructions. The ledger records the row count prominently.

**Errors:** `raw_access_disabled`, `approval_denied` (tells the agent to
continue with aggregates and not to ask again), `unknown_column`,
`empty_dataset`.

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
