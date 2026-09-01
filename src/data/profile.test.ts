import { describe, expect, it } from 'vitest'
import { buildDataset } from './dataset'
import {
  MAX_CATEGORICAL_DISTINCT,
  TOP_CATEGORY_LIMIT,
  profileColumn,
  profileDataset,
  round,
} from './profile'
import type { Dataset } from './types'
import { findColumn } from './types'

const PEOPLE = [
  'name,team,salary,joined,active',
  'Ada,Platform,120000,2024-01-15,yes',
  'Bob,Platform,95000,2024-03-02,yes',
  'Cleo,Design,105000,2023-11-20,no',
  'Dev,Design,,2025-02-01,yes',
  'Eve,Platform,88000,2025-06-11,no',
].join('\n')

const people = (): Dataset => buildDataset({ name: 'people.csv', text: PEOPLE })

function profileOf(dataset: Dataset, name: string, minGroupSize?: number) {
  const column = findColumn(dataset, name)
  if (!column) throw new Error(`no column ${name}`)
  return profileColumn(column, dataset.rowCount, { minGroupSize })
}

describe('profileColumn — counts', () => {
  it('reports totals, nulls and distinct values', () => {
    const profile = profileOf(people(), 'salary')

    expect(profile.count).toBe(5)
    expect(profile.nulls).toBe(1)
    expect(profile.nullRate).toBe(0.2)
    expect(profile.distinct).toBe(4)
  })

  it('reports cells that failed type coercion', () => {
    // 39 of 40 values are numeric — above the 95% confidence threshold — so the
    // column is typed as a number and the stray value is counted as invalid.
    const numeric = buildDataset({
      name: 'numeric.csv',
      text: ['n', ...Array.from({ length: 39 }, (_, i) => String(i)), 'oops'].join('\n'),
    })

    expect(profileOf(numeric, 'n').invalid).toBe(1)
    expect(profileOf(numeric, 'n').nulls).toBe(1)
  })

  it('counts no violations when the column is typed as text', () => {
    // 9 of 10 numeric is below the threshold, so the column stays text and
    // every value is valid for it.
    const mixed = buildDataset({
      name: 'mixed.csv',
      text: ['n', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'oops'].join('\n'),
    })

    expect(profileOf(mixed, 'n').type).toBe('string')
    expect(profileOf(mixed, 'n').invalid).toBe(0)
  })

  it('handles an empty dataset without dividing by zero', () => {
    const dataset = buildDataset({ name: 'headers.csv', text: 'a,b' })
    const profile = profileOf(dataset, 'a')

    expect(profile.count).toBe(0)
    expect(profile.nullRate).toBe(0)
    expect(profile.distinct).toBe(0)
  })
})

describe('profileColumn — statistics', () => {
  it('computes mean, median, standard deviation, min and max for numbers', () => {
    const profile = profileOf(people(), 'salary')

    expect(profile.min).toBe(88000)
    expect(profile.max).toBe(120000)
    expect(profile.mean).toBe(102000)
    expect(profile.medianValue).toBe(100000)
    expect(profile.stdDev).toBeGreaterThan(0)
  })

  it('gives min and max for dates but no mean', () => {
    const profile = profileOf(people(), 'joined')

    expect(profile.min).toBe(Date.parse('2023-11-20'))
    expect(profile.max).toBe(Date.parse('2025-06-11'))
    expect(profile.mean).toBeUndefined()
  })

  it('reports a zero standard deviation for a single value', () => {
    const dataset = buildDataset({ name: 'one.csv', text: 'n\n5' })
    expect(profileOf(dataset, 'n').stdDev).toBe(0)
  })

  it('omits statistics entirely when every value is null', () => {
    const dataset = buildDataset({ name: 'blank.csv', text: 'n\n\n\n' })
    const profile = profileOf(dataset, 'n')

    expect(profile.min).toBeUndefined()
    expect(profile.mean).toBeUndefined()
  })
})

describe('profileColumn — the identifying-column guard', () => {
  it('never reports min or max for a text column', () => {
    const profile = profileOf(people(), 'name')

    // The minimum of a name column is a real person's name.
    expect(profile.min).toBeUndefined()
    expect(profile.max).toBeUndefined()
  })

  it('names categories for a genuinely categorical column', () => {
    const profile = profileOf(people(), 'team')

    expect(profile.topCategories).toEqual([
      { value: 'Platform', count: 3 },
      { value: 'Design', count: 2 },
    ])
  })

  it('withholds categories for a column that is unique per row', () => {
    const profile = profileOf(people(), 'name')

    expect(profile.topCategories).toBeUndefined()
    expect(profile.categoriesWithheld).toMatch(/individual records/i)
  })

  it('withholds categories once distinct values exceed the cap', () => {
    const rows = ['code']
    // Many distinct values, but repeated enough to stay under the ratio guard,
    // so the distinct-count cap is what must catch this.
    for (let i = 0; i < MAX_CATEGORICAL_DISTINCT + 10; i += 1) {
      rows.push(`v${i}`, `v${i}`, `v${i}`)
    }
    const dataset = buildDataset({ name: 'codes.csv', text: rows.join('\n') })

    const profile = profileOf(dataset, 'code')
    expect(profile.topCategories).toBeUndefined()
    expect(profile.categoriesWithheld).toMatch(/identifies rows/i)
  })

  it('describes continuous columns instead of listing their values', () => {
    const profile = profileOf(people(), 'salary')

    expect(profile.topCategories).toBeUndefined()
    expect(profile.categoriesWithheld).toMatch(/continuous/i)
  })

  it('honours the k-anonymity threshold when naming categories', () => {
    const profile = profileOf(people(), 'team', 3)

    // Platform occurs 3 times, Design only 2.
    expect(profile.topCategories).toEqual([{ value: 'Platform', count: 3 }])
  })

  it('withholds every category when none clears the threshold', () => {
    const profile = profileOf(people(), 'team', 4)

    expect(profile.topCategories).toBeUndefined()
    expect(profile.categoriesWithheld).toMatch(/at least 4 times/)
  })

  it('never names more than the category limit', () => {
    const rows = ['grade']
    for (let i = 0; i < 10; i += 1) {
      for (let n = 0; n < 10 - i; n += 1) rows.push(`grade_${i}`)
    }
    const dataset = buildDataset({ name: 'grades.csv', text: rows.join('\n') })

    expect(profileOf(dataset, 'grade').topCategories).toHaveLength(
      TOP_CATEGORY_LIMIT,
    )
  })

  it('orders categories by frequency, most common first', () => {
    const dataset = buildDataset({
      name: 'status.csv',
      text: ['s', 'a', 'b', 'b', 'c', 'c', 'c'].join('\n'),
    })

    expect(profileOf(dataset, 's').topCategories?.map((c) => c.value)).toEqual([
      'c',
      'b',
      'a',
    ])
  })
})

describe('profileColumn — the sparse-identifier guard', () => {
  it('withholds values that are nearly unique among the rows that have one', () => {
    // Twelve rows, ten of them empty; the two that are filled are unique.
    // Dividing distinct values by *total* rows called this a category
    // (2/12 = 0.17). Dividing by the rows that actually hold a value calls it
    // what it is.
    const sparse = buildDataset({
      name: 'cases.csv',
      text: [
        'case_reference,status',
        'REF-88213-ALPHA,open',
        'REF-90117-BRAVO,open',
        ...Array.from({ length: 10 }, () => ',open'),
      ].join('\n'),
    })

    const column = findColumn(sparse, 'case_reference')
    if (!column) throw new Error('missing column')
    const profile = profileColumn(column, sparse.rowCount, { minGroupSize: 1 })

    expect(profile.topCategories).toBeUndefined()
    expect(profile.categoriesWithheld).toMatch(/nearly unique/)
    expect(JSON.stringify(profile)).not.toContain('REF-88213-ALPHA')
  })

  it('still names a genuine category that happens to sit in a sparse column', () => {
    const sparse = buildDataset({
      name: 'outcomes.csv',
      text: [
        'outcome,note',
        ...Array.from({ length: 4 }, () => 'settled,x'),
        ...Array.from({ length: 4 }, () => 'dismissed,x'),
        ...Array.from({ length: 20 }, () => ',x'),
      ].join('\n'),
    })

    const column = findColumn(sparse, 'outcome')
    if (!column) throw new Error('missing column')
    const profile = profileColumn(column, sparse.rowCount, { minGroupSize: 1 })

    expect(profile.topCategories).toEqual([
      { value: 'settled', count: 4 },
      { value: 'dismissed', count: 4 },
    ])
  })
})

describe('profileDataset', () => {
  it('profiles every column by default', () => {
    const outcome = profileDataset(people())

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.profiles.map((profile) => profile.name)).toEqual([
      'name',
      'team',
      'salary',
      'joined',
      'active',
    ])
  })

  it('profiles only the requested columns, in the order requested', () => {
    const outcome = profileDataset(people(), { columns: ['salary', 'team'] })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.profiles.map((profile) => profile.name)).toEqual([
      'salary',
      'team',
    ])
  })

  it('reports unknown columns rather than quietly skipping them', () => {
    const outcome = profileDataset(people(), { columns: ['salary', 'bonus'] })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.unknownColumns).toEqual(['bonus'])
    expect(outcome.availableColumns).toContain('salary')
  })

  it('treats an empty column list as "all columns"', () => {
    const outcome = profileDataset(people(), { columns: [] })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.profiles).toHaveLength(5)
  })
})

describe('round', () => {
  it('trims floating point noise', () => {
    expect(round(0.1 + 0.2, 4)).toBe(0.3)
    expect(round(1 / 3, 3)).toBe(0.333)
  })

  it('passes non-finite values through untouched', () => {
    expect(round(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY)
  })
})
