/**
 * Column profiling.
 *
 * Profiling is what lets an agent orient itself in a dataset it cannot read.
 * That makes it the most tempting exfiltration channel in the app, so two
 * rules constrain what a profile may contain:
 *
 * 1. `min`/`max` are only reported for numbers and dates. The minimum of a
 *    `name` column is somebody's actual name; the minimum of a `salary` column
 *    is a statistic.
 *
 * 2. Top categories are only released when a column looks categorical rather
 *    than identifying — bounded distinct count, and well below one distinct
 *    value per row — and each category must itself clear the k-anonymity
 *    threshold. Otherwise the profile says the values were withheld and why.
 */

import { median } from './query'
import type { CellValue, Column, ColumnType, Dataset } from './types'
import { findColumn } from './types'

/** A column with more distinct values than this is never treated as categorical. */
export const MAX_CATEGORICAL_DISTINCT = 50

/** Nor is one where distinct values approach one per row. */
export const CATEGORICAL_DISTINCT_RATIO = 0.5

/** How many categories a profile may name. */
export const TOP_CATEGORY_LIMIT = 5

export interface TopCategory {
  value: CellValue
  count: number
}

export interface ColumnProfile {
  name: string
  type: ColumnType
  /** Total rows in the dataset. */
  count: number
  nulls: number
  /** Share of rows that are null, 0–1, rounded to three places. */
  nullRate: number
  distinct: number
  /** Cells that held content of the wrong type and were dropped to null. */
  invalid: number
  /** Numbers and dates only. */
  min?: CellValue
  max?: CellValue
  /** Numbers only. */
  mean?: number
  medianValue?: number
  stdDev?: number
  /** Present only when the column is categorical enough to be safe to name. */
  topCategories?: TopCategory[]
  /** Set when categories were withheld, explaining the reason. */
  categoriesWithheld?: string
}

export interface ProfileOptions {
  /** Categories seen fewer times than this are never named. */
  minGroupSize?: number
}

export function profileColumn(
  column: Column,
  rowCount: number,
  options: ProfileOptions = {},
): ColumnProfile {
  const minGroupSize = Math.max(1, Math.trunc(options.minGroupSize ?? 1))

  let nulls = 0
  const counts = new Map<CellValue, number>()
  const numbers: number[] = []

  for (const value of column.values) {
    if (value === null) {
      nulls += 1
      continue
    }
    counts.set(value, (counts.get(value) ?? 0) + 1)
    if (typeof value === 'number') numbers.push(value)
  }

  const profile: ColumnProfile = {
    name: column.name,
    type: column.type,
    count: rowCount,
    nulls,
    nullRate: rowCount === 0 ? 0 : round(nulls / rowCount, 3),
    distinct: counts.size,
    invalid: column.invalidCount,
  }

  // Ordering statistics are safe for numbers and dates, which are measurements.
  // For text they would hand back a real cell value.
  if ((column.type === 'number' || column.type === 'date') && numbers.length > 0) {
    profile.min = minOf(numbers)
    profile.max = maxOf(numbers)
  }

  if (column.type === 'number' && numbers.length > 0) {
    const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length
    profile.mean = round(mean, 4)
    profile.medianValue = round(median(numbers), 4)
    profile.stdDev = round(standardDeviation(numbers, mean), 4)
  }

  const categories = topCategories(column, counts, rowCount, minGroupSize)
  if ('withheld' in categories) profile.categoriesWithheld = categories.withheld
  else profile.topCategories = categories.categories

  return profile
}

type CategoryOutcome =
  | { categories: TopCategory[] }
  | { withheld: string }

function topCategories(
  column: Column,
  counts: Map<CellValue, number>,
  rowCount: number,
  minGroupSize: number,
): CategoryOutcome {
  // Numbers and dates are measurements, not categories; their distribution is
  // already described by min/max/mean/median.
  if (column.type === 'number' || column.type === 'date') {
    return { withheld: 'Continuous column; see min, max, mean and median instead.' }
  }

  if (counts.size === 0) {
    return { categories: [] }
  }

  if (counts.size > MAX_CATEGORICAL_DISTINCT) {
    return {
      withheld: `Withheld: ${counts.size} distinct values means this column identifies rows rather than grouping them.`,
    }
  }

  if (rowCount > 0 && counts.size / rowCount > CATEGORICAL_DISTINCT_RATIO) {
    return {
      withheld:
        'Withheld: values are nearly unique per row, so naming them would reveal individual records.',
    }
  }

  const ranked = [...counts.entries()]
    .filter(([, count]) => count >= minGroupSize)
    .sort((left, right) => right[1] - left[1])
    .slice(0, TOP_CATEGORY_LIMIT)
    .map(([value, count]) => ({ value, count }))

  if (ranked.length === 0) {
    return {
      withheld: `Withheld: no value occurs at least ${minGroupSize} times, the minimum group size in force.`,
    }
  }

  return { categories: ranked }
}

export interface ProfileDatasetOptions extends ProfileOptions {
  /** Restrict to these columns. Unknown names are reported, not ignored. */
  columns?: readonly string[]
}

export type ProfileOutcome =
  | { ok: true; profiles: ColumnProfile[] }
  | { ok: false; unknownColumns: string[]; availableColumns: string[] }

export function profileDataset(
  dataset: Dataset,
  options: ProfileDatasetOptions = {},
): ProfileOutcome {
  const available = dataset.columns.map((column) => column.name)

  if (options.columns && options.columns.length > 0) {
    const unknown = options.columns.filter((name) => !findColumn(dataset, name))
    if (unknown.length > 0) {
      return { ok: false, unknownColumns: unknown, availableColumns: available }
    }
  }

  const selected =
    options.columns && options.columns.length > 0
      ? options.columns.map((name) => findColumn(dataset, name) as Column)
      : dataset.columns

  return {
    ok: true,
    profiles: selected.map((column) =>
      profileColumn(column, dataset.rowCount, options),
    ),
  }
}

// ---------------------------------------------------------------------------

function standardDeviation(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0
  let total = 0
  for (const value of values) total += (value - mean) ** 2
  return Math.sqrt(total / (values.length - 1))
}

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

/** Keeps floating-point noise out of results an agent will read aloud. */
export function round(value: number, places: number): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
