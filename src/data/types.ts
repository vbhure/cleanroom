/**
 * The in-memory dataset model.
 *
 * Storage is columnar: every column owns a dense array of coerced values, and a
 * row is the same index across columns. Analysis in Cleanroom is almost
 * entirely per-column (profiling, aggregation, anomaly detection), so this
 * layout keeps the hot paths simple and allocation-free.
 *
 * Nothing in this module is ever serialised to the network. See docs/SECURITY.md.
 */

export type ColumnType = 'string' | 'number' | 'boolean' | 'date'

/**
 * `date` values are stored as epoch milliseconds so they sort and aggregate
 * like numbers; the column type tells the presentation layer to render them
 * back as dates.
 */
export type CellValue = string | number | boolean | null

export interface Column {
  name: string
  type: ColumnType
  /** Dense, length === Dataset.rowCount. */
  values: CellValue[]
}

export interface Dataset {
  /** Stable slug used by agents to address the dataset. */
  id: string
  /** Original file name, shown to the human. */
  name: string
  rowCount: number
  columns: Column[]
  /** Size of the source text in bytes, for the human's reference only. */
  sourceBytes: number
  loadedAt: number
  /** Rows the parser had to discard, with reasons. Surfaced, never hidden. */
  warnings: string[]
}

export function findColumn(
  dataset: Dataset,
  name: string,
): Column | undefined {
  return dataset.columns.find((column) => column.name === name)
}

export function columnNames(dataset: Dataset): string[] {
  return dataset.columns.map((column) => column.name)
}
