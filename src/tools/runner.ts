/**
 * The single execution path for every tool call.
 *
 * Validate → execute → cap → record. Both consumers go through here: the
 * browser's agent via `document.modelContext`, and the in-app Tool Inspector.
 * There is no second, laxer path, so a judge testing through the Inspector is
 * exercising exactly the code an agent would.
 *
 * A tool never throws at its caller. A thrown exception is converted into a
 * structured error, because the caller is usually a model, and an unexplained
 * rejection tells it nothing it can act on.
 */

import type { WorkspaceStore } from '../state/workspace'
import { capOutput } from './output'
import type { ToolSpec } from './types'
import { fail, isFailure } from './types'
import { validateInput } from './validate'

export interface RunOptions {
  signal?: AbortSignal
}

export interface RunOutcome {
  /** Exactly what the agent receives, after capping. */
  payload: unknown
  characters: number
  truncated: boolean
  ok: boolean
}

export async function runTool(
  spec: ToolSpec,
  workspace: WorkspaceStore,
  rawInput: unknown,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const signal = options.signal ?? new AbortController().signal

  const validation = validateInput(spec.inputSchema, rawInput ?? {})
  if (!validation.ok) {
    return finish(spec, workspace, validation.failure, 0)
  }

  // Registration follows state asynchronously, so a call can arrive in the
  // moment between the trust dial moving and the tool being withdrawn. The
  // decision that counts is the one in force when the call actually runs.
  if (!spec.available(workspace.getState())) {
    return finish(
      spec,
      workspace,
      fail(
        'tool_unavailable',
        `"${spec.name}" has been withdrawn from this workspace. Call list_datasets to see what is loaded and which privacy limits are in force.`,
      ),
      0,
    )
  }

  let outcome
  try {
    outcome = await spec.execute(validation.value, { workspace, signal })
  } catch (error) {
    outcome = {
      error: {
        code: 'tool_failed',
        message:
          error instanceof Error
            ? `The tool failed: ${error.message}`
            : 'The tool failed for an unknown reason.',
      },
    }
  }

  if (isFailure(outcome)) {
    return finish(spec, workspace, outcome, 0)
  }

  return finish(
    spec,
    workspace,
    outcome.payload,
    outcome.rowsReleased ?? 0,
    outcome.summary,
  )
}

function finish(
  spec: ToolSpec,
  workspace: WorkspaceStore,
  payload: unknown,
  rowsReleased: number,
  summary?: string,
): RunOutcome {
  const capped = capOutput(payload)
  const failed =
    typeof capped.value === 'object' &&
    capped.value !== null &&
    'error' in (capped.value as Record<string, unknown>)

  workspace.recordEgress({
    tool: spec.name,
    risk: spec.risk,
    characters: capped.characters,
    // A failed call releases no rows even if the tool would have.
    rowsReleased: failed ? 0 : rowsReleased,
    summary: failed ? describeFailure(spec.name, capped.value) : (summary ?? spec.name),
    truncated: capped.truncated,
  })

  return {
    payload: capped.value,
    characters: capped.characters,
    truncated: capped.truncated,
    ok: !failed,
  }
}

function describeFailure(toolName: string, payload: unknown): string {
  const error = (payload as { error?: { code?: string; message?: string } }).error
  return `${toolName} refused: ${error?.message ?? error?.code ?? 'unknown error'}`
}
