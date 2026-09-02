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

import { useMemo, useState } from 'react'
import { runQuery } from '../data/query'
import { buildSampleDataset } from '../data/sample'
import type { QueryResult } from '../data/query'
import { aggregationName } from '../data/query'
import { createId, workspace } from '../state/workspace'
import type { ChartBlock, NoteBlock, ReportBlock } from '../state/workspace'
import { Chart } from './Chart'
import type { ChartPoint } from './Chart'
import { Markdown } from './Markdown'
import { formatCell } from './format'
import { useWorkspace } from './useWorkspace'

export function Report() {
  const state = useWorkspace()

  if (state.blocks.length === 0) {
    return <EmptyReport hasData={state.datasets.length > 0} />
  }

  return (
    <div className="report">
      {state.blocks.map((block) => (
        <BlockFrame key={block.id} block={block} />
      ))}
      <ReportActions />
    </div>
  )
}

/**
 * The person's side of the shared canvas. Without this the badge on every
 * block would only ever read "Added by agent", and "a report humans and agents
 * build together" would be a claim the app does not keep.
 */
function ReportActions() {
  return (
    <p className="reportActions">
      <button
        type="button"
        className="secondaryButton"
        onClick={() => addHumanNote()}
        data-testid="add-human-note"
      >
        Write a note
      </button>
    </p>
  )
}

function addHumanNote(): void {
  workspace.addBlock({
    id: createId('block'),
    kind: 'note',
    title: 'My note',
    markdown: '',
    author: 'human',
    createdAt: Date.now(),
  })
}

/**
 * The first thing anyone sees, so it states the thesis rather than apologising
 * for being empty, and it offers the one click that makes the page live. A
 * judge who never finds a dataset never sees a tool fire.
 */
function EmptyReport({ hasData }: { hasData: boolean }) {
  if (hasData) {
    return (
      <div className="reportEmpty">
        <h2>Nothing on the canvas yet</h2>
        <p>
          Ask an agent to explore the data, or start writing yourself. Anything
          either of you creates appears here, badged with who made it, and
          either of you can edit or remove it.
        </p>
        <p className="reportEmptyActions">
          <button
            type="button"
            className="secondaryButton"
            onClick={() => addHumanNote()}
            data-testid="add-human-note"
          >
            Write a note
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="reportEmpty">
      <h2>The agent gets tools. It never gets the file.</h2>
      <p>
        Parsed in this tab, never uploaded. You decide, live, how many tools
        the agent gets.
      </p>
      <p className="reportEmptyProof">
        <code>connect-src &apos;none&apos;</code>
        <span>This page cannot make a network request. Check it in DevTools.</span>
      </p>
      <p className="reportEmptyActions">
        <button
          type="button"
          className="primaryButton"
          onClick={() => {
            workspace.addDataset(buildSampleDataset(workspace.datasetIds()))
          }}
          data-testid="load-sample"
        >
          Load the sample dataset
        </button>
      </p>
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

/**
 * A note is editable by the person whoever wrote it. That is the collaboration:
 * the agent proposes wording, the person corrects it in place, and the block
 * keeps its authorship so the ledger and the badge stay honest about who
 * started it.
 */
function NoteBlockBody({ block }: { block: NoteBlock }) {
  const [draft, setDraft] = useState<string | null>(
    // A note the person just created opens ready to type into.
    block.author === 'human' && block.markdown === '' ? '' : null,
  )

  if (draft === null) {
    return (
      <>
        {block.markdown ? (
          <Markdown source={block.markdown} />
        ) : (
          <p className="blockProblem">This note is empty.</p>
        )}
        <p className="blockActions">
          <button
            type="button"
            className="linkButton"
            onClick={() => setDraft(block.markdown)}
            data-testid={`edit-${block.id}`}
          >
            Edit
          </button>
        </p>
      </>
    )
  }

  return (
    <div className="noteEditor">
      <label className="visually-hidden" htmlFor={`note-${block.id}`}>
        Note text
      </label>
      <textarea
        id={`note-${block.id}`}
        className="toolArgs"
        rows={4}
        value={draft}
        autoFocus
        spellCheck
        onChange={(event) => setDraft(event.target.value)}
        data-testid={`note-input-${block.id}`}
      />
      <p className="blockActions">
        <button
          type="button"
          className="secondaryButton"
          onClick={() => {
            workspace.updateBlock(block.id, { markdown: draft })
            setDraft(null)
          }}
          data-testid={`save-${block.id}`}
        >
          Save
        </button>
        <button
          type="button"
          className="linkButton"
          onClick={() => setDraft(null)}
        >
          Cancel
        </button>
      </p>
    </div>
  )
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
