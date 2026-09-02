/**
 * Deterministic data-quality checks.
 *
 * This is the clearest example of work an agent cannot do by looking at a page.
 * It cannot see the rows, and even if it could, spotting an interquartile
 * outlier or a three-week gap in a date series by reading a table is exactly
 * the kind of task language models do unreliably. Here the arithmetic is done
 * by the page and the agent receives a finding it can trust and act on.
 *
 * Every finding is an aggregate: counts, bounds, and rates. No detector emits
 * a cell value from a text column.
 */

import type { Anomaly, AnomalyKind } from './anomalyTypes'
import { compareValues } from './query'
import type { Column, Dataset } from './types'
import { findColumn } from './types'

export type { Anomaly, AnomalyKind } from './anomalyTypes'

/**
 * How many records must sit behind a finding before it may quote a value.
 *
 * An outlier is by definition a small group, and the bounds this module
 * reports are exact cell values. One person earning ten times the median is a
 * finding worth surfacing; their exact salary is not. The threshold used never
 * to reach this module at all, so the person's dial governed query_dataset and
 * left detect_anomalies releasing individual numbers at the aggregates level.
 */
const DEFAULT_MIN_GROUP_SIZE = 1

/** Columns missing more than this share of their values get flagged. */
export const MISSING_RATE_THRESHOLD = 0.1

/** Tukey's fence multiplier: the conventional definition of an outlier. */
export const IQR_MULTIPLIER = 1.5

const DAY_MS = 86_400_000

export const ALL_ANOMALY_KINDS: AnomalyKind[] = [
  'outliers',
  'missing',
  'duplicates',
  'type_violations',
  'gaps',
  'constant',
]

export interface DetectOptions {
  /** Restrict to these columns. Omit for all. */
  columns?: readonly string[]
  /** Restrict to these checks. Omit for all. */
  kinds?: readonly AnomalyKind[]
  /** Findings computed from fewer records than this may not quote values. */
  minGroupSize?: number
}

export type DetectOutcome =
  | { ok: true; anomalies: Anomaly[] }
  | { ok: false; unknownColumns: string[]; availableColumns: string[] }

export function detectAnomalies(
  dataset: Dataset,
  options: DetectOptions = {},
): DetectOutcome {
  const minGroupSize = Math.max(
    1,
    Math.trunc(options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE),
  )
  const available = dataset.columns.map((column) => column.name)

  if (options.columns && options.columns.length > 0) {
    const unknown = options.columns.filter((name) => !findColumn(dataset, name))
    if (unknown.length > 0) {
      return { ok: false, unknownColumns: unknown, availableColumns: available }
    }
  }

  const columns =
    options.columns && options.columns.length > 0
      ? options.columns.map((name) => findColumn(dataset, name) as Column)
      : dataset.columns

  const kinds = new Set<AnomalyKind>(
    options.kinds && options.kinds.length > 0 ? options.kinds : ALL_ANOMALY_KINDS,
  )

  const anomalies: Anomaly[] = []

  for (const column of columns) {
    if (kinds.has('missing')) {
      pushIf(anomalies, detectMissing(column, dataset.rowCount))
    }
    if (kinds.has('type_violations')) {
      pushIf(anomalies, detectTypeViolations(column, dataset.rowCount))
    }
    if (kinds.has('constant')) {
      pushIf(anomalies, detectConstant(column, dataset.rowCount))
    }
    if (kinds.has('outliers') && column.type === 'number') {
      pushIf(anomalies, detectOutliers(column, minGroupSize))
    }
    if (kinds.has('gaps') && column.type === 'date') {
      pushIf(anomalies, detectGaps(column))
    }
  }

  // Duplicate detection is a property of the row, not of any single column, so
  // it only runs when the whole dataset is in scope.
  if (kinds.has('duplicates') && !options.columns?.length) {
    pushIf(anomalies, detectDuplicateRows(dataset))
  }

  anomalies.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === 'warning' ? -1 : 1
    }
    return compareValues(left.column ?? null, right.column ?? null)
  })

  return { ok: true, anomalies }
}

// ---------------------------------------------------------------------------
// detectors
// ---------------------------------------------------------------------------

function detectMissing(column: Column, rowCount: number): Anomaly | undefined {
  if (rowCount === 0) return undefined

  let nulls = 0
  for (const value of column.values) if (value === null) nulls += 1
  if (nulls === 0) return undefined

  const rate = nulls / rowCount
  if (rate < MISSING_RATE_THRESHOLD) return undefined

  return {
    kind: 'missing',
    column: column.name,
    severity: rate >= 0.5 ? 'warning' : 'info',
    summary: `"${column.name}" is missing ${percent(rate)} of its values (${nulls} of ${rowCount}).`,
    detail: { missing: nulls, rows: rowCount, rate: roundTo(rate, 3) },
  }
}

function detectTypeViolations(
  column: Column,
  rowCount: number,
): Anomaly | undefined {
  if (column.invalidCount === 0) return undefined

  return {
    kind: 'type_violations',
    column: column.name,
    severity: 'warning',
    summary: `"${column.name}" holds ${column.type} values, but ${column.invalidCount} cell${column.invalidCount === 1 ? '' : 's'} could not be read as ${column.type} and became empty.`,
    detail: {
      invalid: column.invalidCount,
      rows: rowCount,
      expectedType: column.type,
    },
  }
}

function detectConstant(column: Column, rowCount: number): Anomaly | undefined {
  if (rowCount < 2) return undefined

  const distinct = new Set(column.values)
  distinct.delete(null)
  if (distinct.size !== 1) return undefined

  return {
    kind: 'constant',
    column: column.name,
    severity: 'info',
    summary: `"${column.name}" has the same value in every row, so it cannot distinguish anything.`,
    detail: { distinct: 1, rows: rowCount },
  }
}

function detectOutliers(column: Column, minGroupSize: number): Anomaly | undefined {
  const numbers: number[] = []
  for (const value of column.values) {
    if (typeof value === 'number') numbers.push(value)
  }
  // Quartiles are meaningless on a handful of points.
  if (numbers.length < 8) return undefined

  const sorted = [...numbers].sort((left, right) => left - right)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  if (iqr === 0) return undefined

  const lower = q1 - IQR_MULTIPLIER * iqr
  const upper = q3 + IQR_MULTIPLIER * iqr

  let below = 0
  let above = 0
  let smallest = Number.POSITIVE_INFINITY
  let largest = Number.NEGATIVE_INFINITY

  for (const value of sorted) {
    if (value < lower) {
      below += 1
      if (value < smallest) smallest = value
    } else if (value > upper) {
      above += 1
      if (value > largest) largest = value
    }
  }

  const total = below + above
  if (total === 0) return undefined

  return {
    kind: 'outliers',
    column: column.name,
    severity: total / numbers.length >= 0.05 ? 'warning' : 'info',
    summary: `"${column.name}" has ${total} value${total === 1 ? '' : 's'} outside the expected range ${roundTo(lower, 2)} to ${roundTo(upper, 2)} (${below} low, ${above} high).`,
    detail: {
      method: 'interquartile range',
      lowerBound: roundTo(lower, 4),
      upperBound: roundTo(upper, 4),
      below,
      above,
      // An outlier is a small group by construction, and these bounds are
      // exact cell values. Naming the number when only one or two records sit
      // behind it hands over that person's figure under the cover of a
      // statistic — so above the threshold it is a finding, below it is a
      // count and nothing more.
      ...(below >= minGroupSize ? { lowestOutlier: smallest } : {}),
      ...(above >= minGroupSize ? { highestOutlier: largest } : {}),
      ...(below + above > 0 && (below < minGroupSize || above < minGroupSize)
        ? { boundsWithheld: `Fewer than ${minGroupSize} records on at least one side, so the values are not named.` }
        : {}),
    },
  }
}

function detectGaps(column: Column): Anomaly | undefined {
  const days = new Set<number>()
  for (const value of column.values) {
    if (typeof value === 'number') days.add(Math.floor(value / DAY_MS))
  }
  if (days.size < 3) return undefined

  const sorted = [...days].sort((left, right) => left - right)
  let gapCount = 0
  let largestGap = 0
  let gapStart = 0

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] as number
    const current = sorted[index] as number
    const gap = current - previous
    if (gap > 1) {
      gapCount += 1
      if (gap > largestGap) {
        largestGap = gap
        gapStart = previous
      }
    }
  }

  if (gapCount === 0) return undefined

  return {
    kind: 'gaps',
    column: column.name,
    severity: largestGap >= 7 ? 'warning' : 'info',
    summary: `"${column.name}" has ${gapCount} gap${gapCount === 1 ? '' : 's'} in its date coverage; the longest is ${largestGap - 1} day${largestGap - 1 === 1 ? '' : 's'} with no records.`,
    detail: {
      gaps: gapCount,
      longestGapDays: largestGap - 1,
      longestGapAfter: isoDay(gapStart),
      firstDay: isoDay(sorted[0] as number),
      lastDay: isoDay(sorted.at(-1) as number),
      daysCovered: sorted.length,
    },
  }
}

function detectDuplicateRows(dataset: Dataset): Anomaly | undefined {
  if (dataset.rowCount < 2 || dataset.columns.length === 0) return undefined

  const seen = new Set<string>()
  let duplicates = 0

  for (let row = 0; row < dataset.rowCount; row += 1) {
    const key = JSON.stringify(
      dataset.columns.map((column) => column.values[row] ?? null),
    )
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }

  if (duplicates === 0) return undefined

  return {
    kind: 'duplicates',
    severity: duplicates / dataset.rowCount >= 0.05 ? 'warning' : 'info',
    summary: `${duplicates} row${duplicates === 1 ? ' is an exact duplicate' : 's are exact duplicates'} of an earlier row (${percent(duplicates / dataset.rowCount)} of the dataset).`,
    detail: {
      duplicateRows: duplicates,
      distinctRows: seen.size,
      rows: dataset.rowCount,
    },
  }
}

// ---------------------------------------------------------------------------

function pushIf(target: Anomaly[], anomaly: Anomaly | undefined): void {
  if (anomaly) target.push(anomaly)
}

/** Linear-interpolation quantile over an already-sorted array. */
export function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN
  if (sorted.length === 1) return sorted[0] as number

  const position = (sorted.length - 1) * fraction
  const lowIndex = Math.floor(position)
  const highIndex = Math.ceil(position)
  const low = sorted[lowIndex] as number
  const high = sorted[highIndex] as number

  return low + (high - low) * (position - lowIndex)
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function percent(rate: number): string {
  return `${roundTo(rate * 100, 1)}%`
}

function isoDay(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10)
}
