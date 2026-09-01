/**
 * The shared report surface.
 *
 * Blocks here were created either by a person or by an agent, and the only
 * difference is a badge. Both are editable and removable by the human, which is
 * the point: the agent proposes, the person keeps control.
 *
 * Charts recompute from the local dataset on every render, so changing the
 * report filter or the k-anonymity threshold updates every chart at once
 * without anything being re-fetched — there is nothing to fetch.
 */

import { useMemo } from 'react'
import { runQuery } from '../data/query'
import type { QueryResult } from '../data/query'
import { aggregationName } from '../data/query'
import { workspace } from '../state/workspace'
import type { ChartBlock, NoteBlock, ReportBlock } from '../state/workspace'
import { Chart } from './Chart'
import type { ChartPoint } from './Chart'
import { Markdown } from './Markdown'
import { formatCell } from './format'
import { useWorkspace } from './useWorkspace'

export function Report() {
  const state = useWorkspace()

  if (state.blocks.length === 0) {
    return (
      <div className="reportEmpty">
        <h2>The report is empty</h2>
        <p>
          {state.datasets.length === 0
            ? 'Load a CSV to begin. Your file is parsed here in the browser and never uploaded.'
            : 'Ask an agent to explore the data, or add a chart yourself. Anything either of you creates appears here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="report">
      {state.blocks.map((block) => (
        <BlockFrame key={block.id} block={block} />
      ))}
    </div>
  )
}

function BlockFrame({ block }: { block: ReportBlock }) {
  const label = block.kind === 'chart' ? 'Chart' : 'Note'
  const title = block.title ?? label

  return (
    <article className="block" data-testid={`block-${block.id}`}>
      <header className="blockHeader">
        <div className="blockTitles">
          <h3 className="blockTitle">{title}</h3>
          <span className={`authorBadge author-${block.author}`}>
            {block.author === 'agent' ? 'Added by agent' : 'Added by you'}
          </span>
        </div>
        <button
          type="button"
          className="ghostButton"
          onClick={() => workspace.removeBlock(block.id)}
          aria-label={`Remove ${title}`}
        >
          Remove
        </button>
      </header>

      {block.kind === 'chart' ? (
        <ChartBlockBody block={block} />
      ) : (
        <NoteBlockBody block={block} />
      )}
    </article>
  )
}

function NoteBlockBody({ block }: { block: NoteBlock }) {
  return <Markdown source={block.markdown} />
}

function ChartBlockBody({ block }: { block: ChartBlock }) {
  const state = useWorkspace()
  const dataset = state.datasets.find(
    (candidate) => candidate.id === block.spec.dataset,
  )

  const outcome = useMemo(() => {
    if (!dataset) return undefined

    return runQuery(dataset, {
      where: state.filters[dataset.id] ?? [],
      groupBy: [block.spec.groupBy],
      aggregate: [block.spec.aggregate],
      orderBy: block.spec.orderBy ? [block.spec.orderBy] : undefined,
      limit: block.spec.limit ?? 20,
      minGroupSize: state.minGroupSize,
    })
  }, [dataset, block.spec, state.filters, state.minGroupSize])

  if (!dataset) {
    return (
      <p className="blockProblem">
        The dataset “{block.spec.dataset}” is no longer loaded.
      </p>
    )
  }

  if (!outcome) return null

  if (!outcome.ok) {
    return <p className="blockProblem">{outcome.error.message}</p>
  }

  const { result } = outcome
  const valueName = aggregationName(block.spec.aggregate)
  const points: ChartPoint[] = result.rows.map((row) => ({
    label: row[0] ?? null,
    value: typeof row[1] === 'number' ? row[1] : null,
  }))

  const labelType = result.columns[0]?.type ?? 'string'

  return (
    <>
      <Chart
        type={block.spec.type}
        points={points}
        labelType={labelType}
        valueLabel={`${valueName} by ${block.spec.groupBy}`}
      />
      <ChartTable result={result} />
      <ChartFootnotes
        suppressedGroups={result.suppressedGroups}
        suppressedRows={result.suppressedRows}
        truncated={result.truncated}
        totalGroups={result.totalGroups}
        shown={result.rows.length}
      />
    </>
  )
}

function ChartTable({ result }: { result: QueryResult }) {
  return (
    <details className="chartData">
      <summary>Underlying figures</summary>
      <div className="tableScroll">
        <table className="dataTable">
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column.name}>{column.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {formatCell(cell, result.columns[cellIndex]?.type ?? 'string')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function ChartFootnotes({
  suppressedGroups,
  suppressedRows,
  truncated,
  totalGroups,
  shown,
}: {
  suppressedGroups: number
  suppressedRows: number
  truncated: boolean
  totalGroups: number
  shown: number
}) {
  if (suppressedGroups === 0 && !truncated) return null

  return (
    <ul className="blockFootnotes">
      {suppressedGroups > 0 ? (
        <li>
          {suppressedGroups} group{suppressedGroups === 1 ? '' : 's'} (
          {suppressedRows} row{suppressedRows === 1 ? '' : 's'}) hidden by the
          minimum group size.
        </li>
      ) : null}
      {truncated ? (
        <li>
          Showing {shown} of {totalGroups} groups.
        </li>
      ) : null}
    </ul>
  )
}
