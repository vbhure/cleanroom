/**
 * The Tool Inspector.
 *
 * Discovers tools with `document.modelContext.getTools()` and calls them with
 * `executeTool()` — the same two calls an agent makes. It is not a debug
 * shortcut around the tool layer; it is a client of it, so what happens here is
 * exactly what happens when ChatGPT or Chrome drives the page.
 *
 * That matters for anyone evaluating this app without a WebMCP-capable browser:
 * the whole surface is still inspectable and callable, schemas and all.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { findTool } from '../tools'
import type { RiskClass } from '../tools'
import type { RegisteredTool } from '../webmcp/types'

interface InspectorProps {
  open: boolean
  onToggle: () => void
}

const EXAMPLES: Record<string, unknown> = {
  list_datasets: {},
  describe_columns: { dataset: 'sample_sales', columns: ['deal_size'] },
  query_dataset: {
    dataset: 'sample_sales',
    groupBy: ['region'],
    aggregate: [{ op: 'sum', column: 'deal_size' }],
    orderBy: [{ column: 'sum_of_deal_size', direction: 'desc' }],
  },
  detect_anomalies: { dataset: 'sample_sales' },
  sample_rows: {
    dataset: 'sample_sales',
    rows: 2,
    reason: 'The totals look wrong and I want to check a couple of records.',
  },
  add_chart: {
    dataset: 'sample_sales',
    title: 'Revenue by region',
    type: 'bar',
    groupBy: 'region',
    aggregate: { op: 'sum', column: 'deal_size' },
  },
  add_note: { title: 'Summary', markdown: 'Revenue is concentrated in **East**.' },
  update_report_block: { blockId: 'paste-a-block-id', title: 'Revised title' },
  remove_report_block: { blockId: 'paste-a-block-id' },
  set_report_filter: {
    dataset: 'sample_sales',
    where: [{ column: 'status', op: 'eq', value: 'won' }],
  },
  clear_workspace: { confirm: true },
}

export function Inspector({ open, onToggle }: InspectorProps) {
  const [tools, setTools] = useState<RegisteredTool[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const refresh = useCallback(async () => {
    const context = document.modelContext
    if (!context) return
    setTools(await context.getTools())
  }, [])

  // The registered tool set lives outside React, in the browser's own registry,
  // and announces its changes with `toolchange`. Subscribing to that — plus one
  // read to pick up whatever was already registered before we mounted — is the
  // whole synchronisation.
  useEffect(() => {
    const context = document.modelContext
    if (!context) return

    const onChange = () => void refresh()
    context.addEventListener('toolchange', onChange)
    void refresh()

    return () => context.removeEventListener('toolchange', onChange)
  }, [refresh])

  const active = useMemo(
    () => tools.find((tool) => tool.name === selected),
    [tools, selected],
  )

  function choose(name: string) {
    setSelected(name)
    setResult(null)
    setArgsText(JSON.stringify(EXAMPLES[name] ?? {}, null, 2))
  }

  async function run() {
    if (!active) return
    const context = document.modelContext
    if (!context) return

    let args: unknown
    try {
      args = JSON.parse(argsText)
    } catch (error) {
      setResult(
        `Those arguments are not valid JSON.\n${error instanceof Error ? error.message : ''}`,
      )
      return
    }

    setRunning(true)
    setResult(null)
    try {
      // Exactly the call an agent makes, including the stringified result.
      const raw = await context.executeTool(
        active,
        args as Record<string, unknown>,
      )
      setResult(JSON.stringify(JSON.parse(raw), null, 2))
    } catch (error) {
      setResult(
        `The call was rejected.\n${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className={`inspector${open ? ' inspectorOpen' : ''}`}>
      <button
        type="button"
        className="inspectorToggle"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="inspector-toggle"
      >
        <span>Tool Inspector</span>
        <span className="inspectorCount">{tools.length} registered</span>
        <span className="inspectorChevron">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="inspectorBody">
          <ul className="toolList" data-testid="tool-list">
            {tools.map((tool) => {
              const spec = findTool(tool.name)
              return (
                <li key={tool.name}>
                  <button
                    type="button"
                    className={`toolButton${selected === tool.name ? ' toolButtonActive' : ''}`}
                    onClick={() => choose(tool.name)}
                  >
                    <span
                      className={`riskDot risk-${(spec?.risk ?? 'read') as RiskClass}`}
                    />
                    <code>{tool.name}</code>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="toolDetail">
            {active ? (
              <>
                <p className="toolDescription">{active.description}</p>
                <div className="toolAnnotations">
                  <span>
                    readOnlyHint:{' '}
                    <strong>{String(active.annotations?.readOnlyHint ?? false)}</strong>
                  </span>
                  <span>
                    untrustedContentHint:{' '}
                    <strong>
                      {String(active.annotations?.untrustedContentHint ?? false)}
                    </strong>
                  </span>
                </div>

                <details className="toolSchema">
                  <summary>Input schema</summary>
                  <pre>{JSON.stringify(active.inputSchema, null, 2)}</pre>
                </details>

                <label className="toolArgsLabel" htmlFor="tool-args">
                  Arguments
                </label>
                <textarea
                  id="tool-args"
                  className="toolArgs"
                  value={argsText}
                  spellCheck={false}
                  rows={8}
                  onChange={(event) => setArgsText(event.target.value)}
                  data-testid="tool-args"
                />

                <button
                  type="button"
                  className="primaryButton"
                  onClick={() => void run()}
                  disabled={running}
                  data-testid="tool-run"
                >
                  {running ? 'Waiting…' : `Call ${active.name}`}
                </button>

                {result !== null ? (
                  <>
                    <p className="toolResultLabel">Result returned to the agent</p>
                    <pre className="toolResult" data-testid="tool-result">
                      {result}
                    </pre>
                  </>
                ) : null}
              </>
            ) : (
              <p className="railEmpty">
                Pick a tool to see its schema and call it exactly as an agent
                would.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
