/**
 * Presentation helpers.
 *
 * Dates are stored as epoch milliseconds so they sort and aggregate like
 * numbers; this is where they turn back into dates for a human to read.
 */

import type { CellValue, ColumnType } from '../data/types'

export function formatCell(value: CellValue, type: ColumnType): string {
  if (value === null) return '—'

  if (type === 'date' && typeof value === 'number') {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    // Midnight UTC renders as a plain date; anything else keeps its time.
    return value % 86_400_000 === 0
      ? (date.toISOString().slice(0, 10) as string)
      : date.toISOString().replace('T', ' ').slice(0, 16)
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString()
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false'

  return value
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatCount(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`)
  return `${count.toLocaleString()} ${word}`
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
