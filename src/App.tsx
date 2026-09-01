import { useMemo } from 'react'
import './App.css'
import {
  describeEnvironment,
  detectWebMcpEnvironment,
} from './webmcp/environment'

/**
 * Application shell.
 *
 * Three regions, mirroring the product's three concerns:
 *   left   — the dataset that stays on this device
 *   centre — the report humans and agents build together
 *   right  — everything the agent was allowed to see (the egress ledger)
 */
export default function App() {
  const env = useMemo(() => detectWebMcpEnvironment(), [])

  return (
    <div className="app">
      <header className="appHeader">
        <div className="brand">
          <span className="brandName">Cleanroom</span>
          <span className="brandTagline">
            Analyse a spreadsheet with an AI agent without ever uploading it
          </span>
        </div>
        <div className="headerSpacer" />
        <span
          className="envPill"
          title={describeEnvironment(env)}
          data-testid="env-pill"
        >
          <span className="envDot" data-mode={env.mode} />
          WebMCP: {env.mode}
        </span>
      </header>

      <div className="appBody">
        <aside className="rail railLeft" aria-label="Dataset">
          <h2 className="railHeading">Dataset</h2>
          <p className="railEmpty">No dataset loaded.</p>
        </aside>

        <main className="canvas canvasEmpty">
          <div className="emptyState">
            <h2>Your data never leaves this tab</h2>
            <p>
              Cleanroom parses your spreadsheet in the browser and exposes
              WebMCP tools so an agent can analyse it — receiving only capped
              aggregates, never the file.
            </p>
          </div>
        </main>

        <aside className="rail railRight" aria-label="Egress ledger">
          <h2 className="railHeading">Egress ledger</h2>
          <p className="railEmpty">Nothing has been released to an agent.</p>
        </aside>
      </div>
    </div>
  )
}
