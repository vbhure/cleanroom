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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ALL_TOOLS, findTool } from '../tools'
import type { RiskClass } from '../tools'
import type { RegisteredTool } from '../webmcp/types'

interface InspectorProps {
  open: boolean
  onToggle: () => void
}

const RISK_DESCRIPTION: Record<RiskClass, string> = {
  read: 'read-only',
  write: 'writes to the report, reversible',
  gated: 'needs your approval',
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
  const [captured, setCaptured] = useState<RegisteredTool | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  // `getTools()` is async, and moving the trust dial can fire `toolchange`
  // twice before the first read resolves. Without a sequence number the older
  // answer can land last and leave the count disagreeing with the registry —
  // and that count is the visible consequence of the whole trust dial.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const context = document.modelContext
    if (!context) return

    latest.current += 1
    const ticket = latest.current
    const registered = await context.getTools()
    if (ticket !== latest.current) return
    setTools(registered)
  }, [])

  // The registered tool set lives outside React, in the browser's own registry,
  // and announces its changes with `toolchange`. Subscribing to that — plus one
  // read to pick up whatever was already registered before we mounted — is the
  // whole synchronisation, which is exactly what an effect is for.
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

  const withdrawn = selected !== null && !active && captured !== null

  function choose(name: string) {
    setSelected(name)
    // Keep the tool object `getTools()` handed out at this moment. When the
    // person moves the trust dial the tool leaves `getTools()` and `active`
    // goes undefined — and the panel used to simply blank, throwing away the
    // one gesture that proves what this application claims. A withdrawn tool
    // and a refused tool are indistinguishable if you never get to call
    // either. Holding the stale handle lets the person call it anyway and
    // read the interface's own answer.
    setCaptured(tools.find((tool) => tool.name === name) ?? null)
    setResult(null)
    setArgsText(JSON.stringify(EXAMPLES[name] ?? {}, null, 2))
  }

  async function run() {
    // Deliberately falls back to the captured handle: calling a withdrawn tool
    // is a supported gesture here, not a mistake to guard against.
    const handle = active ?? captured
    if (!handle) return
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
        handle,
        args as Record<string, unknown>,
      )
      setResult(JSON.stringify(JSON.parse(raw), null, 2))
    } catch (error) {
      // Verbatim, and labelled by who said it. This message comes from the
      // WebMCP implementation, not from Cleanroom — which is exactly what
      // makes it worth showing.
      setResult(
        `The interface rejected the call.\n${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
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
        {/*
          Out of how many. "2 registered" on an eleven-tool app reads as "this
          app has two tools"; "2 of 11 registered" reads as the boundary doing
          its job, which is what it is.
        */}
        <span className="inspectorCount" data-testid="inspector-count">
          {tools.length} of {ALL_TOOLS.length} registered
        </span>
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
                      aria-hidden="true"
                      className={`riskDot risk-${(spec?.risk ?? 'read') as RiskClass}`}
                    />
                    <code>{tool.name}</code>
                    {/* The dot is colour; this is the same fact in words. */}
                    <span className="visually-hidden">
                      {RISK_DESCRIPTION[(spec?.risk ?? 'read') as RiskClass]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="toolDetail">
            {withdrawn ? (
              <WithdrawnTool
                name={selected as string}
                argsText={argsText}
                onArgsChange={setArgsText}
                onRun={() => void run()}
                running={running}
                result={result}
              />
            ) : active ? (
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

/**
 * What a withdrawn tool looks like.
 *
 * The distinction this application rests on is that moving the trust dial
 * *unregisters* a tool rather than making it refuse. Those are very different
 * things and they are indistinguishable if the tool merely disappears — every
 * permission system in the world also makes a button disappear.
 *
 * So the handle stays, and so does the button. Pressing it calls the real
 * `document.modelContext.executeTool()` with the object `getTools()` handed
 * out before the dial moved, and prints what comes back. A refusal would
 * return a structured error from Cleanroom. This returns a DOMException from
 * the interface itself, because there is no longer anything of that name to
 * call. That message is the proof, and it is not ours to write.
 */
function WithdrawnTool({
  name,
  argsText,
  onArgsChange,
  onRun,
  running,
  result,
}: {
  name: string
  argsText: string
  onArgsChange: (value: string) => void
  onRun: () => void
  running: boolean
  result: string | null
}) {
  return (
    <>
      <p className="toolWithdrawn" data-testid="tool-withdrawn">
        <span className="toolWithdrawnMark">Withdrawn</span>
        {name} is no longer registered on <code>document.modelContext</code>.
        It was not refused — the trust level you set means there is nothing of
        that name to call.
      </p>

      <p className="toolWithdrawnHint">
        The handle this panel is holding is the one{' '}
        <code>getTools()</code> gave out before you moved the dial. Call it and
        read what the interface says.
      </p>

      <label className="toolArgsLabel" htmlFor="tool-args">
        Arguments
      </label>
      <textarea
        id="tool-args"
        className="toolArgs"
        value={argsText}
        spellCheck={false}
        rows={6}
        onChange={(event) => onArgsChange(event.target.value)}
        data-testid="tool-args"
      />

      <button
        type="button"
        className="dangerButton"
        onClick={onRun}
        disabled={running}
        data-testid="tool-run-stale"
      >
        {running ? 'Waiting…' : 'Call it anyway'}
      </button>

      {result !== null ? (
        <>
          <p className="toolResultLabel">What the interface returned</p>
          <pre className="toolResult" data-testid="tool-result">
            {result}
          </pre>
        </>
      ) : null}
    </>
  )
}
