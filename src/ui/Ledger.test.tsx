import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDataset } from '../data/dataset'
import { workspace } from '../state/workspace'
import { Ledger } from './Ledger'

/**
 * The balance line is the one sentence a person reads to know where they
 * stand: everything held in this tab against everything that has ever left it.
 * It must come straight from the same accounting the ledger rows use.
 */

beforeEach(() => {
  workspace.reset()
})

afterEach(() => {
  cleanup()
  workspace.reset()
})

function loadCsv(name: string, text: string) {
  const dataset = buildDataset({ name, text, existingIds: workspace.datasetIds() })
  workspace.addDataset(dataset)
  return dataset
}

function release(tool: string, characters: number, rowsReleased = 0) {
  workspace.recordEgress({
    tool,
    risk: rowsReleased > 0 ? 'gated' : 'read',
    summary: `${tool} test entry`,
    characters,
    rowsReleased,
    truncated: false,
  })
}

describe('the egress balance', () => {
  it('shows nothing held and nothing released on an empty workspace', () => {
    render(<Ledger />)

    expect(screen.getByTestId('kept-local')).toHaveTextContent('0 B')
    expect(screen.getByTestId('released')).toHaveTextContent('0 B')
    expect(screen.getByTestId('egress-balance')).toHaveTextContent(
      /0 B kept local · 0 B released/,
    )
  })

  it('counts the bytes of every loaded file as kept local', () => {
    const first = loadCsv('a.csv', 'x,y\n1,2\n3,4')
    const second = loadCsv('b.csv', 'name,amount\nAda,100\nBob,250\nCleo,400')
    render(<Ledger />)

    const total = first.sourceBytes + second.sourceBytes
    expect(total).toBeGreaterThan(0)
    expect(screen.getByTestId('kept-local')).toHaveTextContent(`${total} B`)
    expect(screen.getByTestId('released')).toHaveTextContent('0 B')
  })

  it('sums what has been released from the same ledger the rows use', () => {
    loadCsv('a.csv', 'x,y\n1,2')
    release('list_datasets', 300)
    release('query_dataset', 724)
    render(<Ledger />)

    expect(workspace.totalCharactersReleased()).toBe(1024)
    expect(screen.getByTestId('released')).toHaveTextContent('1.0 KB')
    expect(screen.getByTestId('released')).toHaveAttribute(
      'title',
      '1,024 characters of tool output',
    )
  })

  it('shrinks the local side when a dataset is removed, never the released side', () => {
    const dataset = loadCsv('a.csv', 'x,y\n1,2\n3,4')
    release('list_datasets', 120)
    const { rerender } = render(<Ledger />)

    expect(screen.getByTestId('kept-local')).toHaveTextContent(`${dataset.sourceBytes} B`)

    workspace.removeDataset(dataset.id)
    rerender(<Ledger />)

    expect(screen.getByTestId('kept-local')).toHaveTextContent('0 B')
    // What has left the tab has left it; the account never goes backwards.
    expect(screen.getByTestId('released')).toHaveTextContent('120 B')
  })

  it('formats large files in megabytes and small egress in bytes', () => {
    const wide = `${'c,'.repeat(50)}c\n${'1,'.repeat(50)}1\n`.repeat(6000)
    loadCsv('big.csv', wide)
    release('list_datasets', 512)
    render(<Ledger />)

    expect(screen.getByTestId('kept-local')).toHaveTextContent(/MB$/)
    expect(screen.getByTestId('released')).toHaveTextContent('512 B')
  })

  it('keeps the raw-row counter alongside the balance', () => {
    loadCsv('a.csv', 'x,y\n1,2\n3,4')
    release('sample_rows', 90, 2)
    render(<Ledger />)

    expect(screen.getByTestId('rows-released')).toHaveTextContent('2')
    expect(screen.getByTestId('released')).toHaveTextContent('90 B')
  })
})
