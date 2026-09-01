import { useSyncExternalStore } from 'react'
import { workspace } from '../state/workspace'
import type { WorkspaceState } from '../state/workspace'

/**
 * Subscribes a component to the workspace.
 *
 * The store hands back the same state object until something actually changes,
 * so this re-renders exactly when the workspace does — whether the change came
 * from a click or from an agent's tool call. That is what makes the report a
 * genuinely shared surface rather than two views that need reconciling.
 */
export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(
    workspace.subscribe,
    workspace.getState,
    workspace.getState,
  )
}
