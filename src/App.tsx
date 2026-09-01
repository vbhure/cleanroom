import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { workspace } from './state/workspace'
import { ToolRegistrar } from './tools/registry'
import { ApprovalModal } from './ui/ApprovalModal'
import { Inspector } from './ui/Inspector'
import { Ledger } from './ui/Ledger'
import { Report } from './ui/Report'
import { Sidebar } from './ui/Sidebar'
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
 *   right  — everything the agent was allowed to see
 *
 * The tool registrar is started once here and lives for the page's lifetime,
 * keeping the registered tool set in step with the workspace.
 */
export default function App() {
  const env = useMemo(() => detectWebMcpEnvironment(), [])
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | null>(null)

  useEffect(() => {
    if (!env.modelContext) return

    const registrar = new ToolRegistrar({
      modelContext: env.modelContext,
      workspace,
      onError: (tool) =>
        setRegistrationError(`The tool "${tool}" could not be registered.`),
    })

    void registrar.start()
    return () => {
      void registrar.stop()
    }
  }, [env.modelContext])

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
          {env.mode === 'native'
            ? 'WebMCP: native'
            : env.mode === 'polyfill'
              ? 'WebMCP: local fallback'
              : 'WebMCP: unavailable'}
        </span>
      </header>

      {registrationError ? (
        <p className="appBanner" role="alert">
          {registrationError}
        </p>
      ) : null}

      {!env.agentReachable && env.mode !== 'none' ? (
        <p className="appBanner appBannerInfo">
          This browser has no native WebMCP, so an outside agent cannot see these
          tools. Everything still works — open the Tool Inspector below to
          discover and call each tool exactly as an agent would.
        </p>
      ) : null}

      <div className="appBody">
        <Sidebar />

        <main className="canvas" aria-label="Report">
          <Report />
        </main>

        <Ledger />
      </div>

      <Inspector
        open={inspectorOpen}
        onToggle={() => setInspectorOpen((open) => !open)}
      />

      <ApprovalModal />
    </div>
  )
}
