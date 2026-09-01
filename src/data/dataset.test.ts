import { describe, expect, it } from 'vitest'
import { MAX_ROWS, buildDataset, toDatasetId, uniqueDatasetId } from './dataset'

describe('toDatasetId', () => {
  it.each([
    ['sales.csv', 'sales'],
    ['Q3 Revenue Report.CSV', 'q3_revenue_report'],
    ['weird!!name??.csv', 'weird_name'],
    ['.csv', 'dataset'],
    ['', 'dataset'],
  ])('slugs %j to %j', (input, expected) => {
    expect(toDatasetId(input)).toBe(expected)
  })

  it('caps very long names', () => {
    expect(toDatasetId(`${'a'.repeat(200)}.csv`)).toHaveLength(40)
  })
})

describe('uniqueDatasetId', () => {
  it('returns the base when it is free', () => {
    expect(uniqueDatasetId('sales', [])).toBe('sales')
  })

  it('suffixes until it finds a free id', () => {
    expect(uniqueDatasetId('sales', ['sales'])).toBe('sales_2')
    expect(uniqueDatasetId('sales', ['sales', 'sales_2'])).toBe('sales_3')
  })
})

describe('buildDataset', () => {
  const sample = [
    'name,age,joined,active,salary',
    'Ada,36,2024-01-15,yes,"$120,000"',
    'Grace,45,2023-06-01,no,"$150,000"',
    'Alan,41,2025-03-20,yes,',
  ].join('\n')

  it('produces a columnar dataset with inferred types', () => {
    const dataset = buildDataset({ name: 'people.csv', text: sample })

    expect(dataset.id).toBe('people')
    expect(dataset.rowCount).toBe(3)
    expect(dataset.columns.map((c) => [c.name, c.type])).toEqual([
      ['name', 'string'],
      ['age', 'number'],
      ['joined', 'date'],
      ['active', 'boolean'],
      ['salary', 'number'],
    ])
  })

  it('coerces values and represents blanks as null', () => {
    const dataset = buildDataset({ name: 'people.csv', text: sample })
    const byName = Object.fromEntries(dataset.columns.map((c) => [c.name, c.values]))

    expect(byName.age).toEqual([36, 45, 41])
    expect(byName.active).toEqual([true, false, true])
    expect(byName.salary).toEqual([120000, 150000, null])
    expect(byName.joined?.[0]).toBe(Date.parse('2024-01-15'))
  })

  it('gives every column the same length as the row count', () => {
    const dataset = buildDataset({ name: 'ragged.csv', text: 'a,b,c\n1,2\n1,2,3,4' })

    for (const column of dataset.columns) {
      expect(column.values).toHaveLength(dataset.rowCount)
    }
  })

  it('carries parser warnings through to the human', () => {
    const dataset = buildDataset({ name: 'ragged.csv', text: 'a,b,c\n1,2' })
    expect(dataset.warnings.join(' ')).toMatch(/fewer columns/)
  })

  it('avoids id collisions with already-loaded datasets', () => {
    const dataset = buildDataset({
      name: 'sales.csv',
      text: 'a\n1',
      existingIds: ['sales'],
    })
    expect(dataset.id).toBe('sales_2')
  })

  it('handles a header-only file', () => {
    const dataset = buildDataset({ name: 'empty.csv', text: 'a,b,c' })

    expect(dataset.rowCount).toBe(0)
    expect(dataset.columns).toHaveLength(3)
    expect(dataset.columns.every((c) => c.type === 'string')).toBe(true)
  })

  it('handles a completely empty file without throwing', () => {
    const dataset = buildDataset({ name: 'nothing.csv', text: '' })

    expect(dataset.rowCount).toBe(0)
    expect(dataset.columns).toEqual([])
    expect(dataset.warnings.join(' ')).toMatch(/empty/i)
  })

  it('truncates oversized files and warns rather than freezing the tab', () => {
    const lines = ['id']
    for (let i = 0; i < MAX_ROWS + 50; i += 1) lines.push(String(i))

    const dataset = buildDataset({ name: 'big.csv', text: lines.join('\n') })

    expect(dataset.rowCount).toBe(MAX_ROWS)
    expect(dataset.warnings.join(' ')).toMatch(/only the first/i)
  })
})
