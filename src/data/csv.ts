/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled from npm for three reasons: the grammar is
 * genuinely small, it keeps Cleanroom's dependency surface near zero (relevant
 * when the whole pitch is "this page cannot leak your data"), and it lets us
 * report malformed input as warnings the human can see rather than throwing.
 */

export interface ParsedCsv {
  header: string[]
  rows: string[][]
  /** Human-readable notes about rows that were repaired or dropped. */
  warnings: string[]
}

const BOM = '﻿'

/** Detects the delimiter by scoring candidates over the first few lines. */
export function detectDelimiter(text: string): string {
  const candidates = [',', '\t', ';', '|']
  const sample = text.slice(0, 64_000).split(/\r?\n/).slice(0, 20).join('\n')

  let best = ','
  let bestScore = -1

  for (const candidate of candidates) {
    // Count only delimiters outside quotes, so quoted commas do not win.
    let count = 0
    let inQuotes = false
    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i]
      if (char === '"') {
        if (inQuotes && sample[i + 1] === '"') i += 1
        else inQuotes = !inQuotes
      } else if (!inQuotes && char === candidate) {
        count += 1
      }
    }
    if (count > bestScore) {
      bestScore = count
      best = candidate
    }
  }

  return best
}

/**
 * Parses delimited text into a header and rows.
 *
 * Ragged rows are repaired rather than rejected: short rows are padded with
 * empty strings, long rows are truncated, and both are reported as warnings.
 * Silently dropping a user's data would be worse than telling them about it.
 */
export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  const text = input.startsWith(BOM) ? input.slice(1) : input
  const sep = delimiter ?? detectDelimiter(text)
  const warnings: string[] = []

  const records = tokenize(text, sep)
  if (records.length === 0) {
    return { header: [], rows: [], warnings: ['The file is empty.'] }
  }

  const rawHeader = records[0] ?? []
  const header = dedupeHeader(rawHeader.map((name, index) => {
    const trimmed = name.trim()
    return trimmed === '' ? `column_${index + 1}` : trimmed
  }), warnings)

  const width = header.length
  const rows: string[][] = []
  let padded = 0
  let truncated = 0

  for (let i = 1; i < records.length; i += 1) {
    const record = records[i]
    if (!record) continue
    // A trailing newline produces one empty record; that is not a data row.
    if (record.length === 1 && record[0] === '') continue

    if (record.length < width) {
      padded += 1
      while (record.length < width) record.push('')
    } else if (record.length > width) {
      truncated += 1
      record.length = width
    }
    rows.push(record)
  }

  if (padded > 0) {
    warnings.push(
      `${padded} row${padded === 1 ? '' : 's'} had fewer columns than the header and ${padded === 1 ? 'was' : 'were'} padded with empty values.`,
    )
  }
  if (truncated > 0) {
    warnings.push(
      `${truncated} row${truncated === 1 ? '' : 's'} had more columns than the header; the extra values were dropped.`,
    )
  }

  return { header, rows, warnings }
}

/** Splits text into records of fields, honouring quotes and embedded newlines. */
function tokenize(text: string, sep: string): string[][] {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  const endField = () => {
    record.push(field)
    field = ''
  }
  const endRecord = () => {
    endField()
    records.push(record)
    record = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === sep) {
      endField()
    } else if (char === '\n') {
      endRecord()
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i += 1
      endRecord()
    } else {
      field += char
    }
  }

  // Flush the final record unless the file ended exactly on a newline.
  if (field !== '' || record.length > 0) endRecord()

  return records
}

/** Makes header names unique, since downstream code addresses columns by name. */
function dedupeHeader(names: string[], warnings: string[]): string[] {
  const seen = new Map<string, number>()
  const result: string[] = []
  let renamed = 0

  for (const name of names) {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    if (count === 0) {
      result.push(name)
    } else {
      renamed += 1
      result.push(`${name}_${count + 1}`)
    }
  }

  if (renamed > 0) {
    warnings.push(
      `${renamed} duplicate column name${renamed === 1 ? ' was' : 's were'} renamed so every column can be addressed uniquely.`,
    )
  }

  return result
}
