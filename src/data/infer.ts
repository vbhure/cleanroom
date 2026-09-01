/**
 * Type inference and cell coercion.
 *
 * Real spreadsheets are messy: currency symbols, thousands separators, several
 * spellings of "missing". Inference is deliberately conservative — a column
 * only earns a type when nearly all of its non-empty values agree — because a
 * wrong type silently corrupts every statistic computed downstream, and an
 * agent has no way to notice.
 */

import type { CellValue, ColumnType } from './types'

/** A column adopts a type when this share of its non-empty values parse as it. */
export const TYPE_CONFIDENCE_THRESHOLD = 0.95

const NULLISH = new Set(['', 'null', 'na', 'n/a', 'nan', 'none', 'nil', '#n/a'])
const TRUTHY = new Set(['true', 'yes'])
const FALSY = new Set(['false', 'no'])

/** ISO-8601 style dates only. Ambiguous formats like 03/04/2026 stay strings. */
const ISO_DATE =
  /^\d{4}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])([T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function isNullish(raw: string): boolean {
  return NULLISH.has(raw.trim().toLowerCase())
}

export function parseBooleanCell(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase()
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false
  return undefined
}

/**
 * Accepts plain numbers plus the common spreadsheet decorations: a leading
 * currency symbol, thousands separators, and accounting-style parentheses for
 * negatives. Percentages are deliberately *not* accepted — "50%" could mean 50
 * or 0.5, and guessing would corrupt averages.
 */
export function parseNumberCell(raw: string): number | undefined {
  let value = raw.trim()
  if (value === '') return undefined

  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1).trim()
  }

  value = value.replace(/^[-+]?\s*[$£€¥₹]\s*/, (match) => (match.includes('-') ? '-' : ''))
  value = value.replace(/,/g, '')

  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) return undefined

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined

  return negative ? -parsed : parsed
}

/** Returns epoch milliseconds, so dates sort and aggregate like numbers. */
export function parseDateCell(raw: string): number | undefined {
  const value = raw.trim()
  if (!ISO_DATE.test(value)) return undefined

  // Normalise to a strict ISO string first: V8 parses '2026/09/01' as *local*
  // midnight but '2026-09-01' as UTC midnight, which would put two spellings of
  // the same day into different buckets when grouping.
  const iso = value.split('/').join('-').replace(' ', 'T')
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Infers a column's type from its raw string values. */
export function inferColumnType(values: readonly string[]): ColumnType {
  let considered = 0
  let booleans = 0
  let dates = 0
  let numbers = 0

  for (const raw of values) {
    if (isNullish(raw)) continue
    considered += 1
    if (parseBooleanCell(raw) !== undefined) booleans += 1
    if (parseDateCell(raw) !== undefined) dates += 1
    if (parseNumberCell(raw) !== undefined) numbers += 1
  }

  if (considered === 0) return 'string'

  const meets = (count: number) => count / considered >= TYPE_CONFIDENCE_THRESHOLD

  if (meets(booleans)) return 'boolean'
  if (meets(dates)) return 'date'
  if (meets(numbers)) return 'number'
  return 'string'
}

/**
 * Coerces a raw cell to the column's type. Values that do not parse become
 * null rather than throwing: one bad cell should not cost the user their file.
 */
export function coerceCell(raw: string, type: ColumnType): CellValue {
  if (isNullish(raw)) return null

  switch (type) {
    case 'boolean':
      return parseBooleanCell(raw) ?? null
    case 'number':
      return parseNumberCell(raw) ?? null
    case 'date':
      return parseDateCell(raw) ?? null
    case 'string':
      return raw
  }
}
