import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSampleDataset } from '../data/sample'
import { createId, workspace } from '../state/workspace'
import { Report } from './Report'

/**
 * The chart renderer runs its own query. That made it the one place the
 * privacy floor could be bypassed without any tool being involved: a chart
 * drawn from the person's raw `minGroupSize` painted every individual record
 * onto the page while the tool that created it correctly returned nothing and
 * the ledger recorded no release. The screen contradicted both the policy and
 * the receipt.
 */

beforeEach(() => {
  workspace.reset()
})

afterEach(() => {
  cleanup()
  workspace.reset()
})

describe('the chart renderer obeys the same floor as the tools', () => {
  it('will not draw one record per point, whatever the threshold is set to', () => {
    workspace.addDataset(buildSampleDataset(workspace.datasetIds()))
    workspace.setMinGroupSize(1)

    workspace.addBlock({
      id: createId('block'),
      kind: 'chart',
      title: 'Per-record line',
      spec: {
        dataset: 'sample_sales',
        type: 'line',
        groupBy: 'closed_on',
        aggregate: { op: 'max', column: 'deal_size' },
        limit: 50,
      },
      author: 'agent',
      createdAt: Date.now(),
    })

    render(<Report />)

    // Every closed_on holds exactly one row, so at the floor there is nothing
    // to plot — and no individual figure may appear on the page.
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('275')
    expect(rendered).not.toContain('12.5')
    expect(screen.getByText(/nothing to plot/i)).toBeInTheDocument()
  })

  it('draws a chart whose groups clear the floor', () => {
    workspace.addDataset(buildSampleDataset(workspace.datasetIds()))

    workspace.addBlock({
      id: createId('block'),
      kind: 'chart',
      title: 'Revenue by region',
      spec: {
        dataset: 'sample_sales',
        type: 'bar',
        groupBy: 'region',
        aggregate: { op: 'sum', column: 'deal_size' },
      },
      author: 'agent',
      createdAt: Date.now(),
    })

    render(<Report />)

    // Four regions of five rows each: a population, and still plotted. The
    // label appears twice — on the axis and in the figures table below it.
    expect(screen.getAllByText('North').length).toBeGreaterThan(0)
    expect(screen.getAllByText('West').length).toBeGreaterThan(0)
    expect(screen.queryByText(/nothing to plot/i)).not.toBeInTheDocument()
  })
})
