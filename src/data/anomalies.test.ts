import { describe, expect, it } from 'vitest'
import { ALL_ANOMALY_KINDS, detectAnomalies, quantile } from './anomalies'
import type { AnomalyKind } from './anomalies'
import { buildDataset } from './dataset'
import type { Dataset } from './types'

function detect(dataset: Dataset, kinds?: AnomalyKind[], columns?: string[]) {
  const outcome = detectAnomalies(dataset, { kinds, columns })
  if (!outcome.ok) throw new Error(`unexpected failure: ${outcome.unknownColumns}`)
  return outcome.anomalies
}

function csv(...lines: string[]): Dataset {
  return buildDataset({ name: 'test.csv', text: lines.join('\n') })
}

describe('detectAnomalies — outliers', () => {
  it('finds a high outlier using the interquartile range', () => {
    const dataset = csv('n', '10', '11', '12', '13', '14', '15', '16', '5000')

    const [anomaly] = detect(dataset, ['outliers'])
    expect(anomaly?.kind).toBe('outliers')
    expect(anomaly?.column).toBe('n')
    expect(anomaly?.detail?.above).toBe(1)
    expect(anomaly?.detail?.highestOutlier).toBe(5000)
  })

  it('finds a low outlier', () => {
    const dataset = csv('n', '-9000', '10', '11', '12', '13', '14', '15', '16')

    const [anomaly] = detect(dataset, ['outliers'])
    expect(anomaly?.detail?.below).toBe(1)
    expect(anomaly?.detail?.lowestOutlier).toBe(-9000)
  })

  it('reports nothing for a well-behaved column', () => {
    const dataset = csv('n', '10', '11', '12', '13', '14', '15', '16', '17')
    expect(detect(dataset, ['outliers'])).toEqual([])
  })

  it('declines to judge a column with too few values', () => {
    const dataset = csv('n', '1', '2', '9999')
    expect(detect(dataset, ['outliers'])).toEqual([])
  })

  it('reports nothing when every value is identical', () => {
    const dataset = csv('n', ...Array.from({ length: 10 }, () => '7'))
    expect(detect(dataset, ['outliers'])).toEqual([])
  })

  it('ignores non-numeric columns entirely', () => {
    const dataset = csv('label', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h')
    expect(detect(dataset, ['outliers'])).toEqual([])
  })

  it('escalates severity when many values are outliers', () => {
    const values = Array.from({ length: 100 }, (_, i) => String(i % 10))
    for (let i = 0; i < 10; i += 1) values.push('100000')
    const dataset = csv('n', ...values)

    expect(detect(dataset, ['outliers'])[0]?.severity).toBe('warning')
  })
})

describe('detectAnomalies — missing values', () => {
  it('flags a column past the missing-rate threshold', () => {
    const dataset = csv('a,b', '1,x', '2,', '3,', '4,')

    const [anomaly] = detect(dataset, ['missing'])
    expect(anomaly?.column).toBe('b')
    expect(anomaly?.detail?.missing).toBe(3)
    expect(anomaly?.severity).toBe('warning')
  })

  it('stays quiet below the threshold', () => {
    const rows = ['v', ...Array.from({ length: 100 }, (_, i) => (i === 0 ? '' : '1'))]
    expect(detect(csv(...rows), ['missing'])).toEqual([])
  })

  it('says nothing about a complete column', () => {
    expect(detect(csv('a', '1', '2'), ['missing'])).toEqual([])
  })

  it('handles a dataset with no rows', () => {
    expect(detect(csv('a,b'), ['missing'])).toEqual([])
  })
})

describe('detectAnomalies — type violations', () => {
  it('reports cells that could not be read as the column type', () => {
    const values = Array.from({ length: 39 }, (_, i) => String(i))
    const dataset = csv('n', ...values, 'not-a-number')

    const [anomaly] = detect(dataset, ['type_violations'])
    expect(anomaly?.kind).toBe('type_violations')
    expect(anomaly?.detail?.invalid).toBe(1)
    expect(anomaly?.severity).toBe('warning')
  })

  it('reports nothing for a clean column', () => {
    expect(detect(csv('n', '1', '2', '3'), ['type_violations'])).toEqual([])
  })
})

describe('detectAnomalies — duplicates', () => {
  it('counts exact duplicate rows', () => {
    const dataset = csv('a,b', '1,x', '1,x', '2,y', '1,x')

    const [anomaly] = detect(dataset, ['duplicates'])
    expect(anomaly?.kind).toBe('duplicates')
    expect(anomaly?.detail?.duplicateRows).toBe(2)
    expect(anomaly?.detail?.distinctRows).toBe(2)
    expect(anomaly?.column).toBeUndefined()
  })

  it('reports nothing when every row is unique', () => {
    expect(detect(csv('a', '1', '2', '3'), ['duplicates'])).toEqual([])
  })

  it('does not run when the scope is narrowed to specific columns', () => {
    // Restricting to one column would make "duplicate row" mean something else.
    const dataset = csv('a,b', '1,x', '1,y')
    expect(detect(dataset, ['duplicates'], ['a'])).toEqual([])
  })
})

describe('detectAnomalies — date gaps', () => {
  it('finds a gap in date coverage and measures the longest', () => {
    const dataset = csv(
      'd',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-02-01',
    )

    const [anomaly] = detect(dataset, ['gaps'])
    expect(anomaly?.kind).toBe('gaps')
    expect(anomaly?.detail?.gaps).toBe(1)
    expect(anomaly?.detail?.longestGapDays).toBe(28)
    expect(anomaly?.detail?.longestGapAfter).toBe('2026-01-03')
    expect(anomaly?.severity).toBe('warning')
  })

  it('reports nothing for a continuous series', () => {
    const dataset = csv('d', '2026-01-01', '2026-01-02', '2026-01-03')
    expect(detect(dataset, ['gaps'])).toEqual([])
  })

  it('treats repeated days as one day, not a gap', () => {
    const dataset = csv(
      'd',
      '2026-01-01',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    )
    expect(detect(dataset, ['gaps'])).toEqual([])
  })

  it('declines to judge fewer than three days', () => {
    expect(detect(csv('d', '2026-01-01', '2026-03-01'), ['gaps'])).toEqual([])
  })
})

describe('detectAnomalies — constant columns', () => {
  it('flags a column with a single value', () => {
    const dataset = csv('a,b', '1,same', '2,same', '3,same')

    const [anomaly] = detect(dataset, ['constant'])
    expect(anomaly?.column).toBe('b')
    expect(anomaly?.severity).toBe('info')
  })

  it('ignores nulls when deciding whether a column is constant', () => {
    const dataset = csv('b', 'same', '', 'same')
    expect(detect(dataset, ['constant'])[0]?.column).toBe('b')
  })

  it('says nothing about a single-row dataset', () => {
    expect(detect(csv('a', '1'), ['constant'])).toEqual([])
  })
})

describe('detectAnomalies — scoping and errors', () => {
  const messy = () =>
    csv('id,note,amount', '1,,10', '1,,10', '2,,20', '3,,999999')

  it('runs every check by default', () => {
    const anomalies = detect(messy())
    const kinds = new Set(anomalies.map((anomaly) => anomaly.kind))

    expect(kinds.has('missing')).toBe(true)
    expect(kinds.has('duplicates')).toBe(true)
  })

  it('restricts to the requested kinds', () => {
    const anomalies = detect(messy(), ['missing'])
    expect(anomalies.every((anomaly) => anomaly.kind === 'missing')).toBe(true)
  })

  it('restricts to the requested columns', () => {
    const anomalies = detect(messy(), undefined, ['note'])
    expect(anomalies.every((anomaly) => anomaly.column === 'note')).toBe(true)
  })

  it('reports unknown columns rather than ignoring them', () => {
    const outcome = detectAnomalies(messy(), { columns: ['nope'] })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.unknownColumns).toEqual(['nope'])
    expect(outcome.availableColumns).toContain('amount')
  })

  it('orders warnings before informational findings', () => {
    const anomalies = detect(messy())
    const firstInfo = anomalies.findIndex((a) => a.severity === 'info')
    const lastWarning = anomalies.map((a) => a.severity).lastIndexOf('warning')

    if (firstInfo !== -1 && lastWarning !== -1) {
      expect(lastWarning).toBeLessThan(firstInfo)
    }
  })

  it('exposes every kind it can produce', () => {
    expect(ALL_ANOMALY_KINDS).toHaveLength(6)
  })

  it('never emits a text cell value in a finding', () => {
    const dataset = csv(
      'secret,n',
      'alice@example.com,1',
      'alice@example.com,1',
      'bob@example.com,2',
    )

    const serialised = JSON.stringify(detect(dataset))
    expect(serialised).not.toContain('alice@example.com')
    expect(serialised).not.toContain('bob@example.com')
  })
})

describe('quantile', () => {
  it('interpolates between neighbours', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2)
  })

  it('handles degenerate inputs', () => {
    expect(quantile([7], 0.5)).toBe(7)
    expect(Number.isNaN(quantile([], 0.5))).toBe(true)
  })
})
