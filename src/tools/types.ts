/**
 * The shape of a Cleanroom tool.
 *
 * Every tool is described once, here, and that single description drives four
 * things: the JSON Schema advertised to the agent, the validation actually
 * enforced at call time, the risk badge shown to the human, and the entry
 * written to the egress ledger. They cannot drift apart.
 */

import type { ToolAnnotations } from '../webmcp/types'
import type { RiskClass, WorkspaceState, WorkspaceStore } from '../state/workspace'

export type { RiskClass } from '../state/workspace'

import type { JsonSchema } from './schema'

export type { JsonSchema } from './schema'

export interface ToolContext {
  workspace: WorkspaceStore
  /** Aborted when the agent cancels; propagated into approval waits. */
  signal: AbortSignal
}

export interface ToolSuccess {
  payload: unknown
  /** One line for the egress ledger, written for a human skim-reading it. */
  summary: string
  /** Raw data rows released. Non-zero only for an approved sample_rows call. */
  rowsReleased?: number
}

export interface ToolFailure {
  error: {
    code: string
    message: string
    [key: string]: unknown
  }
}

export type ToolOutcome = ToolSuccess | ToolFailure

export function isFailure(outcome: ToolOutcome): outcome is ToolFailure {
  return 'error' in outcome
}

export function fail(
  code: string,
  message: string,
  detail: Record<string, unknown> = {},
): ToolFailure {
  return { error: { code, message, ...detail } }
}

export interface ToolSpec {
  /** Agent-facing identifier. Budget: 30 characters. */
  name: string
  /** Human-facing label used by the browser's own UI. */
  title: string
  /** What it does and when to use it. Budget: 500 characters. */
  description: string
  inputSchema: JsonSchema
  risk: RiskClass
  annotations: ToolAnnotations
  /**
   * Whether this tool should currently be registered. Returning false
   * unregisters it and fires `toolchange`, so the agent's menu always reflects
   * what the app can actually do right now.
   */
  available: (state: WorkspaceState) => boolean
  execute: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolOutcome> | ToolOutcome
}
