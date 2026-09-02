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
 *   left   — the data that stays on this device, and the boundary around it
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
          {/* The page's one h1. The regions below are its sections. */}
          <h1 className="brandName">Cleanroom</h1>
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
