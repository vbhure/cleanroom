/**
 * Left rail: load a file, see what is loaded, and set the guardrails.
 *
 * The guardrails belong to the human and to no one else. `minGroupSize` and
 * raw-row access are read by the tool layer on every call and cannot be
 * overridden by a tool argument, so what is set here is what an agent gets.
 */

import { useId, useRef, useState } from 'react'
import { buildDataset } from '../data/dataset'
import { workspace } from '../state/workspace'
import { formatBytes, formatCount } from './format'
import { useWorkspace } from './useWorkspace'

const SAMPLE_CSV = `region,rep,deal_size,closed_on,segment,status
North,Ada Lovelace,12500,2026-01-05,Enterprise,won
North,Ada Lovelace,8200,2026-01-19,Mid-market,won
North,Bob Chen,3100,2026-01-20,SMB,lost
South,Cleo Marsh,41000,2026-02-02,Enterprise,won
South,Cleo Marsh,5400,2026-02-15,SMB,won
South,Bob Chen,7300,2026-02-18,Mid-market,lost
East,Dev Rao,96000,2026-01-30,Enterprise,won
East,Dev Rao,2200,2026-03-04,SMB,won
East,Eve Nakamura,15800,2026-03-11,Mid-market,won
West,Eve Nakamura,,2026-03-20,Mid-market,open
West,Priya Shah,22400,2026-03-22,Enterprise,won
West,Priya Shah,1900,2026-04-02,SMB,lost
North,Ada Lovelace,33000,2026-04-14,Enterprise,won
South,Cleo Marsh,4700,2026-04-19,SMB,open
East,Dev Rao,58000,2026-05-03,Enterprise,won
West,Priya Shah,9100,2026-05-12,Mid-market,won
North,Bob Chen,6400,2026-05-21,SMB,won
South,Cleo Marsh,275000,2026-06-01,Enterprise,won
East,Eve Nakamura,3300,2026-06-09,SMB,lost
West,Priya Shah,11200,2026-06-18,Mid-market,won`

export function Sidebar() {
  const state = useWorkspace()

  return (
    <aside className="rail railLeft" aria-label="Data and privacy controls">
      <h2 className="railHeading">Your data</h2>
      <DropZone />
      <DatasetList />

      <h2 className="railHeading">Privacy guardrails</h2>
      <Guardrails
        minGroupSize={state.minGroupSize}
        allowSampleRows={state.allowSampleRows}
      />
    </aside>
  )
}

function DropZone() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function load(files: FileList | null) {
    setProblem(null)
    const file = files?.[0]
    if (!file) return

    if (file.size > 25 * 1024 * 1024) {
      setProblem('That file is larger than 25 MB. Try a smaller extract.')
      return
    }

    try {
      const text = await file.text()
      const dataset = buildDataset({
        name: file.name,
        text,
        existingIds: workspace.datasetIds(),
      })

      if (dataset.columns.length === 0) {
        setProblem('That file had no readable columns.')
        return
      }

      workspace.addDataset(dataset)
    } catch {
      setProblem('That file could not be read as text.')
    }
  }

  return (
    <div className="dropZoneWrap">
      <div
        className={`dropZone${dragging ? ' dropZoneActive' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void load(event.dataTransfer.files)
        }}
      >
        <p className="dropZoneTitle">Drop a CSV here</p>
        <p className="dropZoneHint">
          Parsed in this tab. Never uploaded.
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="visually-hidden"
          onChange={(event) => {
            void load(event.target.files)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="secondaryButton"
          onClick={() => inputRef.current?.click()}
        >
          Choose a file
        </button>
      </div>

      <button
        type="button"
        className="linkButton"
        onClick={() => {
          workspace.addDataset(
            buildDataset({
              name: 'sample_sales.csv',
              text: SAMPLE_CSV,
              existingIds: workspace.datasetIds(),
            }),
          )
        }}
      >
        or load a sample dataset
      </button>

      {problem ? (
        <p className="railProblem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

function DatasetList() {
  const state = useWorkspace()

  if (state.datasets.length === 0) {
    return <p className="railEmpty">No dataset loaded yet.</p>
  }

  return (
    <ul className="datasetList">
      {state.datasets.map((dataset) => {
        const filter = state.filters[dataset.id] ?? []

        return (
          <li key={dataset.id} className="datasetItem">
            <div className="datasetHead">
              <span className="datasetName" title={dataset.name}>
                {dataset.name}
              </span>
              <button
                type="button"
                className="ghostButton"
                onClick={() => workspace.removeDataset(dataset.id)}
                aria-label={`Remove ${dataset.name}`}
              >
                Remove
              </button>
            </div>

            <p className="datasetMeta">
              <code>{dataset.id}</code> · {formatCount(dataset.rowCount, 'row')} ·{' '}
              {formatCount(dataset.columns.length, 'column')} ·{' '}
              {formatBytes(dataset.sourceBytes)}
            </p>

            {filter.length > 0 ? (
              <p className="datasetFilter">
                Report filtered:{' '}
                {filter
                  .map((clause) => `${clause.column} ${clause.op} ${String(clause.value ?? '')}`)
                  .join(', ')}{' '}
                <button
                  type="button"
                  className="linkButton"
                  onClick={() => workspace.setFilter(dataset.id, null)}
                >
                  clear
                </button>
              </p>
            ) : null}

            {dataset.warnings.length > 0 ? (
              <ul className="datasetWarnings">
                {dataset.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function Guardrails({
  minGroupSize,
  allowSampleRows,
}: {
  minGroupSize: number
  allowSampleRows: boolean
}) {
  const groupId = useId()
  const rawId = useId()

  return (
    <div className="guardrails">
      <div className="guardrail">
        <label className="guardrailLabel" htmlFor={groupId}>
          Minimum group size
        </label>
        <input
          id={groupId}
          type="number"
          min={1}
          max={100}
          value={minGroupSize}
          className="numberInput"
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            workspace.setMinGroupSize(Number.isNaN(next) ? 1 : next)
          }}
        />
        <p className="guardrailHint">
          Grouped results hide any group smaller than this, so an agent cannot
          isolate an individual. 1 turns it off.
        </p>
      </div>

      <div className="guardrail">
        <label className="guardrailToggle" htmlFor={rawId}>
          <input
            id={rawId}
            type="checkbox"
            checked={allowSampleRows}
            onChange={(event) => workspace.setAllowSampleRows(event.target.checked)}
          />
          <span>Allow raw row requests</span>
        </label>
        <p className="guardrailHint">
          {allowSampleRows
            ? 'An agent may ask to see a few raw rows. You will be asked to approve every request.'
            : 'Off. An agent cannot see any individual record, and asking is refused outright.'}
        </p>
      </div>
    </div>
  )
}
