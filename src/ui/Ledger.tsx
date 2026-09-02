/**
 * The egress ledger.
 *
 * Every tool call an agent makes is itemised here with its risk class, the
 * number of characters the agent received, and any raw rows released. It turns
 * "your data stays local" from a claim into a running account the person can
 * audit at a glance, and one line sums it up: how much is held in this tab
 * against how much has ever left it.
 *
 * Refusals are listed too. Seeing that an agent asked for something and was
 * turned down is at least as informative as seeing what it got.
 */

import { workspace } from '../state/workspace'
import type { EgressEntry, RiskClass } from '../state/workspace'
import { formatBytes, formatCount, formatTime } from './format'
import { useWorkspace } from './useWorkspace'

const RISK_LABEL: Record<RiskClass, string> = {
  read: 'read',
  write: 'write',
  gated: 'gated',
}

export function Ledger() {
  const state = useWorkspace()
  const characters = workspace.totalCharactersReleased()
  const rows = workspace.totalRowsReleased()
  const calls = workspace.totalToolCalls()
  const keptLocal = workspace.totalBytesKeptLocal()

  return (
    <aside className="rail railRight" aria-label="Egress ledger">
      <h2 className="railHeading">Released to the agent</h2>

      {/*
        Tool output is JSON of column names, numbers and our own messages, so
        its character count is its byte count for all practical purposes; the
        exact figure is on the hover and in the totals below.
      */}
      <p className="ledgerBalance" data-testid="egress-balance">
        <strong data-testid="kept-local">{formatBytes(keptLocal)}</strong> kept
        local {'\u00b7'}{' '}
        <strong
          data-testid="released"
          title={`${characters.toLocaleString()} characters of tool output`}
        >
          {formatBytes(characters)}
        </strong>{' '}
        released
      </p>

      <div className="ledgerTotals">
        <div className="ledgerTotal">
          <span className="ledgerTotalValue">{characters.toLocaleString()}</span>
          <span className="ledgerTotalLabel">characters</span>
        </div>
        <div className="ledgerTotal">
          <span
            className={`ledgerTotalValue${rows > 0 ? ' ledgerTotalAlert' : ''}`}
            data-testid="rows-released"
          >
            {rows.toLocaleString()}
          </span>
          <span className="ledgerTotalLabel">raw rows</span>
        </div>
        <div className="ledgerTotal">
          <span className="ledgerTotalValue">{calls.toLocaleString()}</span>
          <span className="ledgerTotalLabel">tool calls</span>
        </div>
      </div>

      <p className="ledgerNote">
        Nothing above left this tab by network:{' '}
        <code>connect-src &apos;none&apos;</code>.
      </p>

      {calls > state.egress.length ? (
        <p className="ledgerWindow" data-testid="ledger-window">
          Showing the most recent {state.egress.length.toLocaleString()} of{' '}
          {calls.toLocaleString()} calls. The totals above count all of them.
        </p>
      ) : null}

      {state.egress.length === 0 ? (
        <p className="railEmpty">No agent has called a tool yet.</p>
      ) : (
        <ol className="ledgerList" data-testid="ledger-list">
          {state.egress.map((entry) => (
            <LedgerRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </aside>
  )
}

function LedgerRow({ entry }: { entry: EgressEntry }) {
  return (
    <li className="ledgerRow">
      <div className="ledgerRowHead">
        <span aria-hidden="true" className={`riskDot risk-${entry.risk}`} />
        <code className="ledgerTool">{entry.tool}</code>
        <span className="visually-hidden">{RISK_LABEL[entry.risk]}</span>
        <span className="ledgerTime">{formatTime(entry.at)}</span>
      </div>

      <p className="ledgerSummary">{entry.summary}</p>

      <p className="ledgerMeta">
        {formatCount(entry.characters, 'character')}
        {entry.rowsReleased > 0 ? (
          <span className="ledgerRaw">
            {' '}
            · {formatCount(entry.rowsReleased, 'raw row')}
          </span>
        ) : null}
        {entry.truncated ? ' · truncated to fit the budget' : null}
      </p>
    </li>
  )
}
