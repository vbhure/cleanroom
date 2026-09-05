/**
 * The human gate.
 *
 * When a tool needs a decision, execution is genuinely suspended inside the
 * tool's `execute` until this dialog is answered. That is the whole point: the
 * gate is enforced by the application, not requested of the model, so no amount
 * of persuasive text in a dataset can talk its way past it.
 *
 * The agent's stated reason is shown verbatim and clearly marked as its words,
 * not ours, so a reason that is itself an injection attempt reads as exactly
 * what it is.
 */

import { useEffect, useRef } from 'react'
import { workspace } from '../state/workspace'
import { useWorkspace } from './useWorkspace'

export function ApprovalModal() {
  const { pendingApproval } = useWorkspace()
  const denyRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!pendingApproval) return

    // Remember where the person was, so answering returns them there rather
    // than dropping focus at the top of the document.
    restoreRef.current = document.activeElement as HTMLElement | null
    denyRef.current?.focus()

    return () => {
      restoreRef.current?.focus?.()
      restoreRef.current = null
    }
  }, [pendingApproval])

  useEffect(() => {
    if (!pendingApproval) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Escape denies. The safe answer must always be the easiest one.
      if (event.key === 'Escape') {
        workspace.resolveApproval(false)
        return
      }

      // A gate the keyboard can walk around is not a gate. Without this, Tab
      // leaves the dialog and reaches the trust dial and the tool list behind
      // it while the page is supposedly suspended waiting for an answer.
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute('disabled'))

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pendingApproval])

  if (!pendingApproval) return null

  const reason =
    typeof pendingApproval.detail?.reason === 'string'
      ? pendingApproval.detail.reason
      : undefined
  const columns = Array.isArray(pendingApproval.detail?.columns)
    ? (pendingApproval.detail.columns as string[])
    : undefined

  return (
    <div className="modalBackdrop" role="presentation">
      <div
        ref={dialogRef}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        data-testid="approval-modal"
      >
        <p className="modalKicker">
          <span aria-hidden="true" className="riskDot risk-gated" /> An agent is
          asking permission
        </p>

        <h2 className="modalTitle" id="approval-title">
          {pendingApproval.question}
        </h2>

        {reason ? (
          <blockquote className="modalQuote">
            <p className="modalQuoteLabel">The agent’s stated reason</p>
            <p className="modalQuoteText">{reason}</p>
          </blockquote>
        ) : null}

        {columns ? (
          <p className="modalDetail">
            Columns: {columns.map((column) => <code key={column}>{column}</code>)}
          </p>
        ) : null}

        <p className="modalWarning" data-testid="approval-warning">
          {pendingApproval.consequence === 'destroy'
            ? 'This permanently discards the data and report blocks held in this tab. Nothing is sent to the agent, and nothing here can be recovered.'
            : 'Anything released here leaves your browser and reaches the agent. This is the only way individual records can do so.'}
        </p>

        <div className="modalActions">
          <button
            ref={denyRef}
            type="button"
            className="primaryButton"
            onClick={() => workspace.resolveApproval(false)}
            data-testid="approval-deny"
          >
            Don’t allow
          </button>
          <button
            type="button"
            className="dangerButton"
            onClick={() => workspace.resolveApproval(true)}
            data-testid="approval-approve"
          >
            Allow this once
          </button>
        </div>
      </div>
    </div>
  )
}
