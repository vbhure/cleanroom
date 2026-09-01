/**
 * Left rail: load a file, see what is loaded, and set the privacy boundary.
 *
 * The boundary belongs to the human and to no one else. The trust dial and
 * `minGroupSize` are read by the tool layer on every call and cannot be
 * overridden by a tool argument, so what is set here is what an agent gets.
 * Moving the dial registers and withdraws WebMCP tools on the spot: the
 * agent's menu shrinks or grows in front of the person.
 */

import { useId, useRef, useState } from 'react'
import { buildDataset } from '../data/dataset'
import { buildSampleDataset } from '../data/sample'
import { ALL_TOOLS } from '../tools'
import { TRUST_LEVELS, workspace } from '../state/workspace'
import type { TrustLevel } from '../state/workspace'
import { formatBytes, formatCount } from './format'
import { useWorkspace } from './useWorkspace'

const TRUST_LABEL: Record<TrustLevel, string> = {
  sealed: 'Sealed',
  aggregates: 'Aggregates',
  raw: 'Raw',
}

const TRUST_HINT: Record<TrustLevel, string> = {
  sealed:
    'The agent can see what is loaded and write to the report, but every tool that computes from your data is withdrawn. Nothing derived from it leaves this tab.',
  aggregates:
    'The agent can profile, query and chart your data and receives only aggregates. The one tool that could reveal a record is not offered at all.',
  raw: 'The agent may ask to see up to 5 raw rows. Each request stops for your decision, with the agent’s reason shown to you verbatim.',
}

export function Sidebar() {
  const state = useWorkspace()

  return (
    <aside className="rail railLeft" aria-label="Data and privacy controls">
      <h2 className="railHeading">Your data</h2>
      <DropZone />
      <DatasetList />

      <h2 className="railHeading">Privacy boundary</h2>
      <Guardrails minGroupSize={state.minGroupSize} trustLevel={state.trustLevel} />
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
        {/*
          The visible "Choose a file" button is the control; this input is the
          mechanism behind it. Left in the tab order it is a stop with no
          visible focus ring and nothing to announce, so it is taken out of it
          and named for anyone who reaches it another way.
        */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          tabIndex={-1}
          aria-label="Choose a CSV file to load"
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
          workspace.addDataset(buildSampleDataset(workspace.datasetIds()))
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
  trustLevel,
}: {
  minGroupSize: number
  trustLevel: TrustLevel
}) {
  const groupId = useId()

  return (
    <div className="guardrails">
      <TrustDial level={trustLevel} />

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
          No answer is computed from fewer records than this, however the agent
          narrows it — by grouping, by filtering, or by asking how many rows
          matched. 1 turns it off.
        </p>
      </div>
    </div>
  )
}

/**
 * The trust dial. Three positions, each a policy about what may leave the
 * data. It is not a preference the tools consult: it decides which tools are
 * registered with the browser at all, so the agent's menu changes the moment
 * the person moves it.
 */
function TrustDial({ level }: { level: TrustLevel }) {
  const name = useId()
  const hintId = useId()
  const state = useWorkspace()

  // The dial's real consequence is the size of the agent's menu, and that
  // number lives at the bottom of a collapsed bar. Repeating it here is the
  // difference between "a preference changed colour" and "five tools just
  // stopped existing".
  const offered = ALL_TOOLS.filter((tool) => tool.available(state)).length

  return (
    <fieldset
      className="guardrail trustDial"
      data-testid="trust-dial"
      aria-describedby={hintId}
    >
      <legend className="guardrailLabel">Trust level</legend>
      <div className="trustOptions">
        {TRUST_LEVELS.map((option) => (
          <label
            key={option}
            className={`trustOption${option === level ? ' trustOptionActive' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === level}
              onChange={() => workspace.setTrustLevel(option)}
              data-testid={`trust-${option}`}
            />
            <span>{TRUST_LABEL[option]}</span>
          </label>
        ))}
      </div>
      <p className="trustCount" data-testid="trust-count">
        <strong>{offered}</strong> of {ALL_TOOLS.length} tools registered for
        the agent right now
      </p>
      {/*
        Announced when the group takes focus, and again when the level changes:
        the hint is the whole explanation of what the person just did.
      */}
      <p
        id={hintId}
        className="guardrailHint"
        data-testid="trust-hint"
        aria-live="polite"
      >
        {TRUST_HINT[level]}
      </p>
    </fieldset>
  )
}
