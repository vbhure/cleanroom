/**
 * Builds the in-memory columnar dataset from delimited text.
 *
 * Everything here runs in the browser tab and stays there. The dataset object
 * is never stringified for transport; only the capped aggregates produced by
 * the query and profile layers are ever visible to an agent.
 */

import { parseCsv } from './csv'
import { coerceCell, inferColumnType } from './infer'
import type { Column, Dataset } from './types'

/** Above this the browser tab starts to feel it; we truncate and say so. */
export const MAX_ROWS = 100_000

/** Turns a file name into a stable identifier an agent can address. */
export function toDatasetId(name: string): string {
  const slug = name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

  return slug === '' ? 'dataset' : slug
}

/** Ensures the id is unique among already-loaded datasets. */
export function uniqueDatasetId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`
    if (!taken.includes(candidate)) return candidate
  }
}

export interface BuildDatasetOptions {
  name: string
  text: string
  /** Ids already in use, so the new dataset gets a distinct handle. */
  existingIds?: readonly string[]
  delimiter?: string
}

export function buildDataset({
  name,
  text,
  existingIds = [],
  delimiter,
}: BuildDatasetOptions): Dataset {
  const parsed = parseCsv(text, delimiter)
  const warnings = [...parsed.warnings]

  let rows = parsed.rows
  if (rows.length > MAX_ROWS) {
    warnings.push(
      `The file has ${rows.length.toLocaleString()} rows. Only the first ${MAX_ROWS.toLocaleString()} were loaded to keep the page responsive.`,
    )
    rows = rows.slice(0, MAX_ROWS)
  }

  const columns: Column[] = parsed.header.map((columnName, index) => {
    const raw = rows.map((row) => row[index] ?? '')
    const type = inferColumnType(raw)
    return {
      name: columnName,
      type,
      values: raw.map((cell) => coerceCell(cell, type)),
    }
  })

  return {
    id: uniqueDatasetId(toDatasetId(name), existingIds),
    name,
    rowCount: rows.length,
    columns,
    sourceBytes: new Blob([text]).size,
    loadedAt: Date.now(),
    warnings,
  }
}
