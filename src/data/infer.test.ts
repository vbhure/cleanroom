import { describe, expect, it } from 'vitest'
import {
  coerceCell,
  inferColumnType,
  isNullish,
  parseBooleanCell,
  parseDateCell,
  parseNumberCell,
} from './infer'

describe('isNullish', () => {
  it.each(['', '  ', 'NULL', 'null', 'NA', 'n/a', 'NaN', 'None', '#N/A'])(
    'treats %j as missing',
    (value) => expect(isNullish(value)).toBe(true),
  )

  it.each(['0', 'false', '-', 'nothing'])('does not treat %j as missing', (value) =>
    expect(isNullish(value)).toBe(false),
  )
})

describe('parseBooleanCell', () => {
  it('accepts common spellings in any case', () => {
    expect(parseBooleanCell('TRUE')).toBe(true)
    expect(parseBooleanCell('yes')).toBe(true)
    expect(parseBooleanCell('False')).toBe(false)
    expect(parseBooleanCell(' no ')).toBe(false)
  })

  it('rejects 1 and 0 so numeric columns are not mistaken for flags', () => {
    expect(parseBooleanCell('1')).toBeUndefined()
    expect(parseBooleanCell('0')).toBeUndefined()
  })
})

describe('parseNumberCell', () => {
  it('parses plain numbers', () => {
    expect(parseNumberCell('42')).toBe(42)
    expect(parseNumberCell('-3.5')).toBe(-3.5)
    expect(parseNumberCell('.5')).toBe(0.5)
    expect(parseNumberCell('1e3')).toBe(1000)
  })

  it('parses spreadsheet decorations', () => {
    expect(parseNumberCell('1,234.56')).toBeCloseTo(1234.56)
    expect(parseNumberCell('$1,200')).toBe(1200)
    expect(parseNumberCell('₹2,50,000')).toBe(250000)
    expect(parseNumberCell('(500)')).toBe(-500)
    expect(parseNumberCell('-$40')).toBe(-40)
  })

  it('rejects percentages rather than guessing their scale', () => {
    expect(parseNumberCell('50%')).toBeUndefined()
  })

  it.each(['', 'abc', '12abc', '1.2.3', 'Infinity', '--4'])(
    'rejects %j',
    (value) => expect(parseNumberCell(value)).toBeUndefined(),
  )
})

describe('parseDateCell', () => {
  it('parses ISO dates and timestamps', () => {
    expect(parseDateCell('2026-09-01')).toBe(Date.parse('2026-09-01'))
    expect(parseDateCell('2026-09-01T13:45:00Z')).toBe(
      Date.parse('2026-09-01T13:45:00Z'),
    )
    expect(parseDateCell('2026/09/01')).toBe(Date.parse('2026-09-01'))
  })

  it('rejects ambiguous and invalid dates', () => {
    expect(parseDateCell('03/04/2026')).toBeUndefined()
    expect(parseDateCell('2026-13-01')).toBeUndefined()
    expect(parseDateCell('2026-09-32')).toBeUndefined()
    expect(parseDateCell('not a date')).toBeUndefined()
  })
})

describe('inferColumnType', () => {
  it('infers each type from clean data', () => {
    expect(inferColumnType(['1', '2', '3'])).toBe('number')
    expect(inferColumnType(['yes', 'no', 'yes'])).toBe('boolean')
    expect(inferColumnType(['2026-01-01', '2026-02-01'])).toBe('date')
    expect(inferColumnType(['alpha', 'beta'])).toBe('string')
  })

  it('ignores missing values when judging a column', () => {
    expect(inferColumnType(['1', '', 'NA', '3'])).toBe('number')
  })

  it('falls back to string when a column is not consistent enough', () => {
    // 3 of 4 numeric is 75%, below the 95% threshold.
    expect(inferColumnType(['1', '2', '3', 'pending'])).toBe('string')
  })

  it('tolerates stragglers up to the confidence threshold', () => {
    // 99 of 100 numeric is 99%, at or above the 95% threshold.
    const mostlyNumeric = Array.from({ length: 100 }, (_, i) => String(i))
    mostlyNumeric[42] = 'unknown'
    expect(inferColumnType(mostlyNumeric)).toBe('number')

    // 90 of 100 numeric is below the threshold, so the column stays text.
    const mixed = Array.from({ length: 100 }, (_, i) =>
      i < 10 ? 'pending' : String(i),
    )
    expect(inferColumnType(mixed)).toBe('string')
  })

  it('treats an all-empty column as string', () => {
    expect(inferColumnType(['', '', 'NA'])).toBe('string')
    expect(inferColumnType([])).toBe('string')
  })
})

describe('coerceCell', () => {
  it('maps missing values to null for every type', () => {
    for (const type of ['string', 'number', 'boolean', 'date'] as const) {
      expect(coerceCell('N/A', type)).toBeNull()
    }
  })

  it('coerces to the column type', () => {
    expect(coerceCell('$1,000', 'number')).toBe(1000)
    expect(coerceCell('yes', 'boolean')).toBe(true)
    expect(coerceCell('2026-09-01', 'date')).toBe(Date.parse('2026-09-01'))
    expect(coerceCell('  hi  ', 'string')).toBe('  hi  ')
  })

  it('returns null for a value that does not fit its column, instead of throwing', () => {
    expect(coerceCell('pending', 'number')).toBeNull()
    expect(coerceCell('maybe', 'boolean')).toBeNull()
  })
})
