import { describe, expect, it } from 'vitest'
import { buildDataset } from './dataset'
import {
  MAX_ROW_LIMIT,
  coerceFilterValue,
  compareValues,
  median,
  runQuery,
} from './query'
import type { QueryOutcome, QuerySpec } from './query'
import type { Dataset } from './types'

const SALES = [
  'region,rep,amount,closed,closed_on',
  'North,Ada,100,yes,2026-01-05',
  'North,Ada,250,yes,2026-02-11',
  'North,Bob,75,no,2026-01-20',
  'South,Cleo,400,yes,2026-03-02',
  'South,Cleo,50,no,2026-03-15',
  'East,Dev,900,yes,2026-01-30',
  'West,Eve,,yes,2026-02-28',
].join('\n')

const sales = (): Dataset => buildDataset({ name: 'sales.csv', text: SALES })

/** Unwraps a successful outcome, failing loudly with the error if it is not. */
function expectOk(outcome: QueryOutcome) {
  if (!outcome.ok) {
    throw new Error(`expected success, got ${outcome.error.code}: ${outcome.error.message}`)
  }
  return outcome.result
}

function expectError(outcome: QueryOutcome) {
  if (outcome.ok) throw new Error('expected an error, got a result')
  return outcome.error
}

const countAll: QuerySpec = { aggregate: [{ op: 'count' }] }

describe('runQuery — the privacy boundary', () => {
  it('refuses a query with no aggregation and points at the gated tool', () => {
    const error = expectError(runQuery(sales(), { aggregate: [] }))

    expect(error.code).toBe('no_aggregation')
    expect(error.message).toContain('sample_rows')
  })

  it('refuses when aggregate is missing entirely', () => {
    const error = expectError(
      runQuery(sales(), {} as unknown as QuerySpec),
    )
    expect(error.code).toBe('no_aggregation')
  })

  it('never returns more rows than the hard cap, whatever the agent asks for', () => {
    const rows = ['id']
    for (let i = 0; i < 500; i += 1) rows.push(String(i))
    const wide = buildDataset({ name: 'wide.csv', text: rows.join('\n') })

    const result = expectOk(
      runQuery(wide, { groupBy: ['id'], aggregate: [{ op: 'count' }], limit: 10_000 }),
    )

    expect(result.rows.length).toBe(MAX_ROW_LIMIT)
    expect(result.totalGroups).toBe(500)
    expect(result.truncated).toBe(true)
  })
})

describe('runQuery — k-anonymity suppression', () => {
  it('is inactive by default', () => {
    const result = expectOk(
      runQuery(sales(), { groupBy: ['rep'], aggregate: [{ op: 'count' }] }),
    )

    expect(result.suppressedGroups).toBe(0)
    expect(result.rows).toHaveLength(5)
  })

  it('folds away groups below the threshold the human set', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['rep'],
        aggregate: [{ op: 'count' }],
        minGroupSize: 2,
      }),
    )

    // Ada and Cleo have 2 rows each; Bob, Dev and Eve have 1 each.
    expect(result.rows).toHaveLength(2)
    expect(result.suppressedGroups).toBe(3)
    expect(result.suppressedRows).toBe(3)
  })

  it('does not suppress an ungrouped total, which identifies nobody', () => {
    const result = expectOk(runQuery(sales(), { ...countAll, minGroupSize: 100 }))

    expect(result.rows).toEqual([[7]])
    expect(result.suppressedGroups).toBe(0)
  })

  it('treats a threshold below 1 as disabled rather than erasing everything', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['rep'],
        aggregate: [{ op: 'count' }],
        minGroupSize: 0,
      }),
    )

    expect(result.rows).toHaveLength(5)
  })
})

describe('runQuery — aggregation', () => {
  it('counts every row when ungrouped', () => {
    expect(expectOk(runQuery(sales(), countAll)).rows).toEqual([[7]])
  })

  it('computes sum, avg, min, max and median, ignoring nulls', () => {
    const result = expectOk(
      runQuery(sales(), {
        aggregate: [
          { op: 'sum', column: 'amount' },
          { op: 'avg', column: 'amount' },
          { op: 'min', column: 'amount' },
          { op: 'max', column: 'amount' },
          { op: 'median', column: 'amount' },
        ],
      }),
    )

    // Six numeric values: 100, 250, 75, 400, 50, 900. The seventh is blank.
    const [row] = result.rows
    expect(row?.[0]).toBe(1775)
    expect(row?.[1]).toBeCloseTo(1775 / 6)
    expect(row?.[2]).toBe(50)
    expect(row?.[3]).toBe(900)
    expect(row?.[4]).toBe(175)
  })

  it('counts distinct non-null values', () => {
    const result = expectOk(
      runQuery(sales(), { aggregate: [{ op: 'count_distinct', column: 'region' }] }),
    )
    expect(result.rows[0]?.[0]).toBe(4)
  })

  it('returns null rather than NaN for a group with no numeric values', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['rep'],
        aggregate: [{ op: 'sum', column: 'amount' }],
        orderBy: [{ column: 'rep' }],
      }),
    )

    const eve = result.rows.find((row) => row[0] === 'Eve')
    expect(eve?.[1]).toBeNull()
  })

  it('names output columns predictably and honours an alias', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['region'],
        aggregate: [
          { op: 'count' },
          { op: 'sum', column: 'amount' },
          { op: 'avg', column: 'amount', as: 'average_deal' },
        ],
      }),
    )

    expect(result.columns.map((column) => column.name)).toEqual([
      'region',
      'count',
      'sum_of_amount',
      'average_deal',
    ])
  })

  it('keeps dates as dates through min and max', () => {
    const result = expectOk(
      runQuery(sales(), { aggregate: [{ op: 'min', column: 'closed_on' }] }),
    )

    expect(result.columns[0]?.type).toBe('date')
    expect(result.rows[0]?.[0]).toBe(Date.parse('2026-01-05'))
  })
})

describe('runQuery — grouping', () => {
  it('groups and aggregates together', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['region'],
        aggregate: [{ op: 'count' }, { op: 'sum', column: 'amount' }],
        orderBy: [{ column: 'sum_of_amount', direction: 'desc' }],
      }),
    )

    expect(result.rows[0]).toEqual(['East', 1, 900])
    expect(result.totalGroups).toBe(4)
    expect(result.matchedRows).toBe(7)
  })

  it('supports grouping by several columns', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['region', 'rep'],
        aggregate: [{ op: 'count' }],
      }),
    )

    expect(result.totalGroups).toBe(5)
    expect(result.columns.map((column) => column.name)).toEqual([
      'region',
      'rep',
      'count',
    ])
  })

  it('keeps a null group distinct from a group whose key is the text "null"', () => {
    const dataset = buildDataset({
      name: 'nulls.csv',
      text: 'label,n\n,1\nnull,2\nreal,3',
    })

    const result = expectOk(
      runQuery(dataset, { groupBy: ['label'], aggregate: [{ op: 'count' }] }),
    )

    // "" and "null" are both nullish spellings, so they collapse to one null
    // group, leaving that plus "real".
    expect(result.totalGroups).toBe(2)
  })
})

describe('runQuery — filtering', () => {
  const run = (spec: QuerySpec) => runQuery(sales(), spec)

  it('filters by equality and inequality', () => {
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'region', op: 'eq', value: 'North' }] }))
        .rows[0]?.[0],
    ).toBe(3)

    expect(
      expectOk(run({ ...countAll, where: [{ column: 'region', op: 'ne', value: 'North' }] }))
        .rows[0]?.[0],
    ).toBe(4)
  })

  it('filters numerically with the ordering operators', () => {
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'amount', op: 'gte', value: 250 }] }))
        .rows[0]?.[0],
    ).toBe(3)

    expect(
      expectOk(run({ ...countAll, where: [{ column: 'amount', op: 'lt', value: 100 }] }))
        .rows[0]?.[0],
    ).toBe(2)
  })

  it('accepts a numeric filter sent as a string, as an agent may', () => {
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'amount', op: 'gte', value: '250' }] }))
        .rows[0]?.[0],
    ).toBe(3)
  })

  it('filters dates against an ISO string', () => {
    expect(
      expectOk(
        run({
          ...countAll,
          where: [{ column: 'closed_on', op: 'gte', value: '2026-03-01' }],
        }),
      ).rows[0]?.[0],
    ).toBe(2)
  })

  it('filters booleans', () => {
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'closed', op: 'eq', value: true }] }))
        .rows[0]?.[0],
    ).toBe(5)
  })

  it('supports contains and starts_with case-insensitively', () => {
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'rep', op: 'contains', value: 'd' }] }))
        .rows[0]?.[0],
    ).toBe(3)

    expect(
      expectOk(
        run({ ...countAll, where: [{ column: 'region', op: 'starts_with', value: 'no' }] }),
      ).rows[0]?.[0],
    ).toBe(3)
  })

  it('supports in', () => {
    expect(
      expectOk(
        run({
          ...countAll,
          where: [{ column: 'region', op: 'in', value: ['North', 'South'] }],
        }),
      ).rows[0]?.[0],
    ).toBe(5)
  })

  it('supports null tests', () => {
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'amount', op: 'is_null' }] }))
        .rows[0]?.[0],
    ).toBe(1)

    expect(
      expectOk(run({ ...countAll, where: [{ column: 'amount', op: 'is_not_null' }] }))
        .rows[0]?.[0],
    ).toBe(6)
  })

  it('excludes null cells from comparison filters', () => {
    // The blank amount must not match "less than 1000".
    expect(
      expectOk(run({ ...countAll, where: [{ column: 'amount', op: 'lt', value: 1000 }] }))
        .rows[0]?.[0],
    ).toBe(6)
  })

  it('applies several filters as a conjunction', () => {
    expect(
      expectOk(
        run({
          ...countAll,
          where: [
            { column: 'region', op: 'eq', value: 'North' },
            { column: 'closed', op: 'eq', value: true },
          ],
        }),
      ).rows[0]?.[0],
    ).toBe(2)
  })

  it('returns an empty aggregate rather than an error when nothing matches', () => {
    const result = expectOk(
      run({
        aggregate: [{ op: 'sum', column: 'amount' }],
        where: [{ column: 'region', op: 'eq', value: 'Nowhere' }],
      }),
    )

    expect(result.matchedRows).toBe(0)
    expect(result.rows[0]?.[0]).toBeNull()
  })
})

describe('runQuery — errors are actionable', () => {
  it('lists the real columns when one is misspelled', () => {
    const error = expectError(
      runQuery(sales(), { ...countAll, groupBy: ['regoin'] }),
    )

    expect(error.code).toBe('unknown_column')
    expect(error.detail?.availableColumns).toContain('region')
  })

  it('reports an unknown column used in a filter', () => {
    const error = expectError(
      runQuery(sales(), { ...countAll, where: [{ column: 'nope', op: 'eq', value: 1 }] }),
    )
    expect(error.code).toBe('unknown_column')
  })

  it('reports an unknown column used in an aggregation', () => {
    const error = expectError(
      runQuery(sales(), { aggregate: [{ op: 'sum', column: 'nope' }] }),
    )
    expect(error.code).toBe('unknown_column')
  })

  it('suggests numeric columns when a numeric aggregation is misapplied', () => {
    const error = expectError(
      runQuery(sales(), { aggregate: [{ op: 'sum', column: 'region' }] }),
    )

    expect(error.code).toBe('type_mismatch')
    expect(error.detail?.numericColumns).toEqual(['amount'])
  })

  it('rejects min/max on a text column', () => {
    const error = expectError(
      runQuery(sales(), { aggregate: [{ op: 'max', column: 'region' }] }),
    )
    expect(error.code).toBe('type_mismatch')
  })

  it('requires a column for aggregations other than count', () => {
    const error = expectError(runQuery(sales(), { aggregate: [{ op: 'sum' }] }))
    expect(error.code).toBe('invalid_aggregation')
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects a limit of %s', (limit) => {
    const error = expectError(runQuery(sales(), { ...countAll, limit }))
    expect(error.code).toBe('invalid_limit')
  })

  it('rejects an uninterpretable filter value', () => {
    const error = expectError(
      runQuery(sales(), {
        ...countAll,
        where: [{ column: 'amount', op: 'gt', value: 'lots' }],
      }),
    )
    expect(error.code).toBe('invalid_filter')
  })

  it('rejects an empty "in" list', () => {
    const error = expectError(
      runQuery(sales(), {
        ...countAll,
        where: [{ column: 'region', op: 'in', value: [] }],
      }),
    )
    expect(error.code).toBe('invalid_filter')
  })

  it('rejects a non-string value for contains', () => {
    const error = expectError(
      runQuery(sales(), {
        ...countAll,
        where: [{ column: 'region', op: 'contains', value: 42 }],
      }),
    )
    expect(error.code).toBe('invalid_filter')
  })

  it('lists result columns when ordering by something that is not there', () => {
    const error = expectError(
      runQuery(sales(), { ...countAll, orderBy: [{ column: 'amount' }] }),
    )

    expect(error.code).toBe('unknown_column')
    expect(error.detail?.resultColumns).toEqual(['count'])
  })
})

describe('runQuery — ordering', () => {
  it('sorts ascending by default and descending on request', () => {
    const ascending = expectOk(
      runQuery(sales(), {
        groupBy: ['region'],
        aggregate: [{ op: 'count' }],
        orderBy: [{ column: 'region' }],
      }),
    )
    expect(ascending.rows.map((row) => row[0])).toEqual([
      'East',
      'North',
      'South',
      'West',
    ])

    const descending = expectOk(
      runQuery(sales(), {
        groupBy: ['region'],
        aggregate: [{ op: 'count' }],
        orderBy: [{ column: 'region', direction: 'desc' }],
      }),
    )
    expect(descending.rows.map((row) => row[0])).toEqual([
      'West',
      'South',
      'North',
      'East',
    ])
  })

  it('breaks ties with the second sort key', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['region', 'rep'],
        aggregate: [{ op: 'count' }],
        orderBy: [
          { column: 'count', direction: 'desc' },
          { column: 'rep' },
        ],
      }),
    )

    expect(result.rows[0]?.[2]).toBe(2)
  })
})

describe('runQuery — scale', () => {
  it('aggregates a hundred thousand rows without exhausting the stack', () => {
    const lines = ['bucket,value']
    for (let i = 0; i < 100_000; i += 1) {
      lines.push(`${i % 4},${i}`)
    }
    const dataset = buildDataset({ name: 'big.csv', text: lines.join('\n') })

    const result = expectOk(
      runQuery(dataset, {
        groupBy: ['bucket'],
        aggregate: [
          { op: 'count' },
          { op: 'max', column: 'value' },
          { op: 'min', column: 'value' },
        ],
      }),
    )

    expect(result.rows).toHaveLength(4)
    expect(result.matchedRows).toBe(100_000)
  })
})

describe('helpers', () => {
  it('median handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([7])).toBe(7)
  })

  it('compareValues sorts nulls last regardless of direction', () => {
    expect(compareValues(null, 5)).toBe(1)
    expect(compareValues(5, null)).toBe(-1)
    expect(compareValues(null, null)).toBe(0)
  })

  it('compareValues orders numbers numerically, not lexically', () => {
    expect(compareValues(9, 10)).toBe(-1)
  })

  it('compareValues orders booleans false before true', () => {
    expect(compareValues(false, true)).toBe(-1)
  })

  it('coerceFilterValue rejects values it cannot interpret', () => {
    expect(coerceFilterValue('abc', 'number')).toBeUndefined()
    expect(coerceFilterValue('maybe', 'boolean')).toBeUndefined()
    expect(coerceFilterValue('yesterday', 'date')).toBeUndefined()
    expect(coerceFilterValue({}, 'string')).toBeUndefined()
    expect(coerceFilterValue(Number.POSITIVE_INFINITY, 'number')).toBeUndefined()
  })

  it('coerceFilterValue passes null through for any type', () => {
    expect(coerceFilterValue(null, 'number')).toBeNull()
  })
})

describe('runQuery — null ordering', () => {
  it('keeps null aggregates last when sorting descending', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['region'],
        aggregate: [{ op: 'sum', column: 'amount' }],
        orderBy: [{ column: 'sum_of_amount', direction: 'desc' }],
      }),
    )

    expect(result.rows.map((row) => row[0])).toEqual([
      'East',
      'South',
      'North',
      'West',
    ])
    expect(result.rows.at(-1)?.[1]).toBeNull()
  })

  it('keeps null aggregates last when sorting ascending too', () => {
    const result = expectOk(
      runQuery(sales(), {
        groupBy: ['region'],
        aggregate: [{ op: 'sum', column: 'amount' }],
        orderBy: [{ column: 'sum_of_amount', direction: 'asc' }],
      }),
    )

    expect(result.rows.at(-1)?.[0]).toBe('West')
  })
})
