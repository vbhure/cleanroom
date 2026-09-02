/**
 * The query engine.
 *
 * Two design decisions here are privacy decisions, not ergonomics:
 *
 * 1. Every query must aggregate. There is no way to project raw rows through
 *    this path — that requires the separate, human-gated `sample_rows` tool.
 *    Without this rule an agent could drain a dataset one SELECT at a time.
 *
 * 2. Results honour a k-anonymity threshold the human controls, at both ends.
 *    Any number computed from fewer than k records is suppressed, however the
 *    narrowing happened — and so is any number computed from all but fewer
 *    than k, because the whole-file total is always available to subtract it
 *    from. The single exception is the whole file itself, which describes the
 *    dataset the person loaded rather than anyone in it, and whose size is
 *    already public through `list_datasets`.
 *
 * Errors are returned, never thrown, and carry enough context for an agent to
 * correct itself without a human in the loop.
 */

import { parseDateCell, parseNumberCell } from './infer'
import type { CellValue, ColumnType, Dataset } from './types'
import { columnNames, findColumn } from './types'

export const DEFAULT_ROW_LIMIT = 20
export const MAX_ROW_LIMIT = 50

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'in'
  | 'is_null'
  | 'is_not_null'

export interface Filter {
  column: string
  op: FilterOp
  value?: unknown
}

export type AggregateOp =
  | 'count'
  | 'count_distinct'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'median'

export interface Aggregation {
  op: AggregateOp
  /** Required for every op except `count`. */
  column?: string
  /** Output column name. Defaults to `count` or `op_of_column`. */
  as?: string
}

export interface OrderBy {
  column: string
  direction?: 'asc' | 'desc'
}

export interface QuerySpec {
  where?: Filter[]
  groupBy?: string[]
  aggregate: Aggregation[]
  orderBy?: OrderBy[]
  limit?: number
  /** Groups smaller than this are suppressed. 1 disables suppression. */
  minGroupSize?: number
}

export interface ResultColumn {
  name: string
  type: ColumnType
}

export interface QueryResult {
  columns: ResultColumn[]
  rows: CellValue[][]
  /** Rows matching `where`, before grouping and limiting. */
  matchedRows: number
  /** Distinct groups produced, before the limit was applied. */
  totalGroups: number
  /** True when `limit` hid some groups. */
  truncated: boolean
  /** Groups folded away by the k-anonymity threshold, if any. */
  suppressedGroups: number
  suppressedRows: number
  /**
   * Columns where a numeric aggregate ignored blank cells.
   *
   * `avg`, `sum` and `median` divide by the cells that hold a number, while
   * `count` counts rows. Both are right, and together they look wrong: a group
   * of five with one blank reports a sum and an average that do not reconcile.
   * Naming the column lets the tool layer explain it instead of leaving a
   * reader to assume the engine is broken.
   */
  blanksSkipped: string[]
  /**
   * True when `matchedRows` is itself identifying — fewer records than the
   * threshold, and not simply the whole file. The count is still reported here
   * because the person may see it; the tool layer decides whether to release
   * it, and does not.
   */
  matchedRowsIdentifying: boolean
}

export interface QueryError {
  code:
    | 'unknown_column'
    | 'no_aggregation'
    | 'invalid_aggregation'
    | 'invalid_filter'
    | 'invalid_limit'
    | 'type_mismatch'
  message: string
  detail?: Record<string, unknown>
}

export type QueryOutcome =
  | { ok: true; result: QueryResult }
  | { ok: false; error: QueryError }

const NUMERIC_OPS = new Set<AggregateOp>(['sum', 'avg', 'median'])
const ORDERABLE_OPS = new Set<AggregateOp>(['min', 'max'])

export function runQuery(dataset: Dataset, spec: QuerySpec): QueryOutcome {
  const available = columnNames(dataset)

  const unknown = (name: string): QueryOutcome => ({
    ok: false,
    error: {
      code: 'unknown_column',
      message: `There is no column named "${name}" in dataset "${dataset.id}".`,
      detail: { availableColumns: available },
    },
  })

  // --- validate aggregations ------------------------------------------------
  if (!Array.isArray(spec.aggregate) || spec.aggregate.length === 0) {
    return {
      ok: false,
      error: {
        code: 'no_aggregation',
        message:
          'Every query must produce at least one aggregate. To read individual rows, use sample_rows, which asks the person for permission first.',
        detail: {
          availableAggregations: [
            'count',
            'count_distinct',
            'sum',
            'avg',
            'min',
            'max',
            'median',
          ],
        },
      },
    }
  }

  for (const agg of spec.aggregate) {
    if (agg.op !== 'count' && !agg.column) {
      return {
        ok: false,
        error: {
          code: 'invalid_aggregation',
          message: `The "${agg.op}" aggregation needs a column.`,
        },
      }
    }
    if (agg.column) {
      const column = findColumn(dataset, agg.column)
      if (!column) return unknown(agg.column)

      if (NUMERIC_OPS.has(agg.op) && column.type !== 'number') {
        return {
          ok: false,
          error: {
            code: 'type_mismatch',
            message: `"${agg.op}" needs a number column, but "${column.name}" holds ${column.type} values.`,
            detail: {
              numericColumns: dataset.columns
                .filter((candidate) => candidate.type === 'number')
                .map((candidate) => candidate.name),
            },
          },
        }
      }

      if (
        ORDERABLE_OPS.has(agg.op) &&
        column.type !== 'number' &&
        column.type !== 'date'
      ) {
        return {
          ok: false,
          error: {
            code: 'type_mismatch',
            message: `"${agg.op}" needs a number or date column, but "${column.name}" holds ${column.type} values.`,
          },
        }
      }
    }
  }

  // --- validate grouping ----------------------------------------------------
  const groupBy = spec.groupBy ?? []
  for (const name of groupBy) {
    if (!findColumn(dataset, name)) return unknown(name)
  }

  // --- validate limit -------------------------------------------------------
  const requestedLimit = spec.limit ?? DEFAULT_ROW_LIMIT
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return {
      ok: false,
      error: {
        code: 'invalid_limit',
        message: `limit must be a whole number of at least 1 (got ${String(spec.limit)}).`,
        detail: { maximum: MAX_ROW_LIMIT },
      },
    }
  }
  const limit = Math.min(requestedLimit, MAX_ROW_LIMIT)

  // --- filter ---------------------------------------------------------------
  const filtered = applyFilters(dataset, spec.where ?? [])
  if (!filtered.ok) return filtered
  const matchingRows = filtered.rows

  // --- group ----------------------------------------------------------------
  const groups = groupRows(dataset, matchingRows, groupBy)

  const minGroupSize = Math.max(1, Math.trunc(spec.minGroupSize ?? 1))
  let suppressedGroups = 0
  let suppressedRows = 0
  const kept: GroupEntry[] = []
  const blanksSkipped = new Set<string>()

  // A result computed from fewer than `minGroupSize` records describes those
  // records rather than a population, however the narrowing happened — by a
  // `groupBy` or by a `where`.
  //
  // The threshold has to hold at BOTH ends, and this is the part that is easy
  // to get wrong. An aggregate over the whole file is always available, so any
  // answer covering all-but-a-few records lets the agent subtract:
  //
  //   sum(deal_size)                        over 20 rows -> 616,500
  //   sum(deal_size) where closed_on != X   over 19 rows -> 341,500
  //   difference                                         -> 275,000
  //
  // Two individually permitted queries, one person's exact figure. So a
  // complement smaller than the threshold is as identifying as a group
  // smaller than the threshold, and is refused on the same rule.
  //
  // A complement of exactly zero is the one safe case: that is the whole file,
  // which describes the dataset the person loaded rather than anyone in it,
  // and whose size is already public through list_datasets.
  const identifies = (rows: number): boolean => {
    if (minGroupSize <= 1) return false // the threshold is off

    // The whole file is the one safe answer at any threshold: it describes the
    // dataset the person loaded rather than anyone in it, and its size is
    // already public through list_datasets. This has to come first, or a file
    // smaller than the threshold would answer nothing at all.
    if (rows === dataset.rowCount) return false

    if (rows < minGroupSize) return true // too few records behind the number

    // Both complements matter, because both totals are obtainable: the whole
    // file always, and the matched set by re-running the same filter without a
    // groupBy. Either subtraction isolates the remainder.
    const outsideThisGroup = matchingRows.length - rows
    const outsideTheFilter = dataset.rowCount - rows

    return (
      (outsideThisGroup > 0 && outsideThisGroup < minGroupSize) ||
      (outsideTheFilter > 0 && outsideTheFilter < minGroupSize)
    )
  }

  for (const group of groups) {
    if (identifies(group.rows.length)) {
      suppressedGroups += 1
      suppressedRows += group.rows.length
      continue
    }
    kept.push(group)
  }

  // --- aggregate ------------------------------------------------------------
  const aggregateNames = spec.aggregate.map(aggregationName)
  const resultColumns: ResultColumn[] = [
    ...groupBy.map((name) => ({
      name,
      type: findColumn(dataset, name)?.type ?? ('string' as ColumnType),
    })),
    ...spec.aggregate.map((agg, index) => ({
      name: aggregateNames[index] as string,
      type: aggregateResultType(dataset, agg),
    })),
  ]

  let rows: CellValue[][] = kept.map((group) => [
    ...group.key,
    ...spec.aggregate.map((agg) =>
      computeAggregate(dataset, group.rows, agg, blanksSkipped),
    ),
  ])

  // --- order ----------------------------------------------------------------
  const orderBy = spec.orderBy ?? []
  for (const clause of orderBy) {
    if (!resultColumns.some((column) => column.name === clause.column)) {
      return {
        ok: false,
        error: {
          code: 'unknown_column',
          message: `Cannot order by "${clause.column}" because it is not one of the result columns.`,
          detail: { resultColumns: resultColumns.map((column) => column.name) },
        },
      }
    }
  }

  if (orderBy.length > 0) {
    const indexed = orderBy.map((clause) => ({
      index: resultColumns.findIndex((column) => column.name === clause.column),
      sign: clause.direction === 'desc' ? -1 : 1,
    }))

    rows = [...rows].sort((left, right) => {
      for (const { index, sign } of indexed) {
        const a = left[index] ?? null
        const b = right[index] ?? null

        // Nulls sort last in *both* directions. Without this, "top regions by
        // revenue" descending would hand the agent the regions with no revenue
        // at all, which is the opposite of what was asked for.
        if (a === null || b === null) {
          if (a === null && b === null) continue
          return a === null ? 1 : -1
        }

        const comparison = compareValues(a, b)
        if (comparison !== 0) return comparison * sign
      }
      return 0
    })
  }

  const totalGroups = rows.length

  return {
    ok: true,
    result: {
      columns: resultColumns,
      rows: rows.slice(0, limit),
      matchedRows: matchingRows.length,
      totalGroups,
      truncated: totalGroups > limit,
      suppressedGroups,
      suppressedRows,
      matchedRowsIdentifying: identifies(matchingRows.length),
      blanksSkipped: [...blanksSkipped].sort(),
    },
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

interface GroupEntry {
  key: CellValue[]
  rows: number[]
}

type FilterOutcome =
  | { ok: true; rows: number[] }
  | { ok: false; error: QueryError }

function applyFilters(
  dataset: Dataset,
  filters: readonly Filter[],
): FilterOutcome {
  const predicates: ((rowIndex: number) => boolean)[] = []

  for (const filter of filters) {
    const column = findColumn(dataset, filter.column)
    if (!column) {
      return {
        ok: false,
        error: {
          code: 'unknown_column',
          message: `There is no column named "${filter.column}" in dataset "${dataset.id}".`,
          detail: { availableColumns: columnNames(dataset) },
        },
      }
    }

    const { op } = filter

    if (op === 'is_null' || op === 'is_not_null') {
      const wantNull = op === 'is_null'
      predicates.push((index) => (column.values[index] === null) === wantNull)
      continue
    }

    if (op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        return invalidFilter(
          `The "in" filter on "${column.name}" needs a non-empty array of values.`,
        )
      }

      const coerced: CellValue[] = []
      for (const candidate of filter.value) {
        const value = coerceFilterValue(candidate, column.type)
        if (value === undefined) {
          return invalidFilter(
            `"${String(candidate)}" is not a valid ${column.type} value for column "${column.name}".`,
          )
        }
        coerced.push(value)
      }

      const set = new Set(coerced)
      predicates.push((index) => set.has(column.values[index] ?? null))
      continue
    }

    if (op === 'contains' || op === 'starts_with') {
      if (typeof filter.value !== 'string') {
        return invalidFilter(
          `The "${op}" filter on "${column.name}" needs a string value.`,
        )
      }

      const needle = filter.value.toLowerCase()
      predicates.push((index) => {
        const cell = column.values[index]
        if (cell === null || cell === undefined) return false
        const haystack = String(cell).toLowerCase()
        return op === 'contains'
          ? haystack.includes(needle)
          : haystack.startsWith(needle)
      })
      continue
    }

    const target = coerceFilterValue(filter.value, column.type)
    if (target === undefined) {
      return invalidFilter(
        `"${String(filter.value)}" is not a valid ${column.type} value for column "${column.name}".`,
      )
    }

    predicates.push((index) => {
      const cell = column.values[index]
      if (cell === null || cell === undefined) return false

      const comparison = compareValues(cell, target)
      switch (op) {
        case 'eq':
          return comparison === 0
        case 'ne':
          return comparison !== 0
        case 'gt':
          return comparison > 0
        case 'gte':
          return comparison >= 0
        case 'lt':
          return comparison < 0
        case 'lte':
          return comparison <= 0
        default:
          return false
      }
    })
  }

  const rows: number[] = []
  for (let index = 0; index < dataset.rowCount; index += 1) {
    if (predicates.every((predicate) => predicate(index))) rows.push(index)
  }

  return { ok: true, rows }
}

function invalidFilter(message: string): { ok: false; error: QueryError } {
  return { ok: false, error: { code: 'invalid_filter', message } }
}

/** Accepts the JSON shapes an agent will realistically send for each type. */
export function coerceFilterValue(
  value: unknown,
  type: ColumnType,
): CellValue | undefined {
  if (value === null) return null

  switch (type) {
    case 'number': {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
      }
      if (typeof value === 'string') return parseNumberCell(value)
      return undefined
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase()
        if (lowered === 'true' || lowered === 'yes') return true
        if (lowered === 'false' || lowered === 'no') return false
      }
      return undefined
    }
    case 'date': {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
      }
      if (typeof value === 'string') return parseDateCell(value)
      return undefined
    }
    case 'string': {
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      }
      return undefined
    }
  }
}

function groupRows(
  dataset: Dataset,
  rowIndexes: readonly number[],
  groupBy: readonly string[],
): GroupEntry[] {
  if (groupBy.length === 0) {
    return [{ key: [], rows: [...rowIndexes] }]
  }

  const columns = groupBy.map((name) => findColumn(dataset, name))
  const byKey = new Map<string, GroupEntry>()

  for (const rowIndex of rowIndexes) {
    const key = columns.map((column) => column?.values[rowIndex] ?? null)
    // JSON gives an unambiguous key: it cannot be confused across element
    // boundaries, and it keeps the number 1 distinct from the string "1".
    const hash = JSON.stringify(key)

    const existing = byKey.get(hash)
    if (existing) existing.rows.push(rowIndex)
    else byKey.set(hash, { key, rows: [rowIndex] })
  }

  return [...byKey.values()]
}

export function aggregationName(agg: Aggregation): string {
  if (agg.as) return agg.as
  if (agg.op === 'count') return 'count'
  return `${agg.op}_of_${agg.column}`
}

function aggregateResultType(dataset: Dataset, agg: Aggregation): ColumnType {
  if (agg.op === 'count' || agg.op === 'count_distinct') return 'number'

  const column = agg.column ? findColumn(dataset, agg.column) : undefined
  // min/max preserve the source type, which matters for dates.
  if (ORDERABLE_OPS.has(agg.op) && column?.type === 'date') return 'date'
  return 'number'
}

function computeAggregate(
  dataset: Dataset,
  rowIndexes: readonly number[],
  agg: Aggregation,
  blanksSkipped: Set<string>,
): CellValue {
  if (agg.op === 'count') return rowIndexes.length

  const column = agg.column ? findColumn(dataset, agg.column) : undefined
  if (!column) return null

  if (agg.op === 'count_distinct') {
    const seen = new Set<CellValue>()
    for (const index of rowIndexes) {
      const value = column.values[index]
      if (value !== null && value !== undefined) seen.add(value)
    }
    return seen.size
  }

  const numbers: number[] = []
  for (const index of rowIndexes) {
    const value = column.values[index]
    if (typeof value === 'number') numbers.push(value)
  }

  // A blank is not a zero, so it is skipped rather than counted — but the
  // reader has to be told, or sum and avg appear to contradict each other.
  if (numbers.length < rowIndexes.length) blanksSkipped.add(column.name)

  if (numbers.length === 0) return null

  switch (agg.op) {
    case 'sum':
      return sum(numbers)
    case 'avg':
      return sum(numbers) / numbers.length
    case 'min':
      return minOf(numbers)
    case 'max':
      return maxOf(numbers)
    case 'median':
      return median(numbers)
    default:
      return null
  }
}

function sum(values: readonly number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}

// Written as loops rather than Math.min(...values): spreading a 100k-element
// array overflows the call stack.
function minOf(values: readonly number[]): number {
  let smallest = Number.POSITIVE_INFINITY
  for (const value of values) if (value < smallest) smallest = value
  return smallest
}

function maxOf(values: readonly number[]): number {
  let largest = Number.NEGATIVE_INFINITY
  for (const value of values) if (value > largest) largest = value
  return largest
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number)
}

/** Total ordering across cell values; nulls sort last. */
export function compareValues(left: CellValue, right: CellValue): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1

  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return left === right ? 0 : left ? 1 : -1
  }

  const a = String(left)
  const b = String(right)
  return a < b ? -1 : a > b ? 1 : 0
}
