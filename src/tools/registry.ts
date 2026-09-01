/**
 * WebMCP registration and lifecycle.
 *
 * Tools are registered and unregistered as the workspace changes, which is the
 * point of `toolchange`: before a file is loaded the agent is offered only
 * `list_datasets` and `add_note`, and the moment a dataset arrives the querying
 * and charting tools appear. The agent's menu always describes what the app can
 * actually do right now, so it never proposes an action that cannot work.
 *
 * Unregistration uses the AbortSignal the specification provides for exactly
 * this purpose, rather than any bookkeeping of our own.
 */

import type { WorkspaceStore } from '../state/workspace'
import type { ModelContext } from '../webmcp/types'
import { ALL_TOOLS } from './index'
import { runTool } from './runner'
import type { ToolSpec } from './types'

export interface RegistrarOptions {
  modelContext: ModelContext
  workspace: WorkspaceStore
  tools?: readonly ToolSpec[]
  /** Origins allowed to see these tools. Omitted means same-origin only. */
  exposedTo?: string[]
  onError?: (tool: string, error: unknown) => void
}

interface Registration {
  controller: AbortController
  /** Resolves once registerTool has settled, so teardown cannot race it. */
  settled: Promise<void>
}

export class ToolRegistrar {
  /**
   * Registrations are a side effect on one shared object — the browser's
   * registry — and names on it are unique, so two registrars overlapping means
   * the second one's `registerTool` is rejected for a name the first has not
   * finished releasing. That is not hypothetical: React's StrictMode mounts
   * every effect twice in development, and without this queue `npm run dev`
   * came up with a registration error and a tool missing.
   *
   * Serialising start and stop across instances costs nothing — both are
   * already async, and only one registrar is live at a time — and it makes
   * teardown-then-setup mean what it says.
   */
  private static sequence: Promise<void> = Promise.resolve()

  private static enqueue(work: () => Promise<void>): Promise<void> {
    const next = ToolRegistrar.sequence.then(work, work)
    ToolRegistrar.sequence = next.catch(() => {})
    return next
  }

  private readonly registrations = new Map<string, Registration>()
  private unsubscribe: (() => void) | null = null
  private syncing = false
  private resyncQueued = false

  private readonly options: RegistrarOptions

  constructor(options: RegistrarOptions) {
    this.options = options
  }

  private get tools(): readonly ToolSpec[] {
    return this.options.tools ?? ALL_TOOLS
  }

  /** Registers the currently-available tools and keeps them in step with state. */
  async start(): Promise<void> {
    if (this.unsubscribe) return

    this.unsubscribe = this.options.workspace.subscribe(() => {
      void this.sync()
    })

    await ToolRegistrar.enqueue(() => this.sync())
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null

    await ToolRegistrar.enqueue(async () => {
      for (const [name, registration] of this.registrations) {
        registration.controller.abort()
        await registration.settled.catch(() => {})
        this.registrations.delete(name)
      }
    })
  }

  /** Tool names currently registered. Exposed for tests and the Inspector. */
  registeredNames(): string[] {
    return [...this.registrations.keys()]
  }

  private async sync(): Promise<void> {
    // Registration is async; a burst of state changes must not interleave.
    if (this.syncing) {
      this.resyncQueued = true
      return
    }
    this.syncing = true

    try {
      const state = this.options.workspace.getState()
      const shouldBeRegistered = new Set(
        this.tools.filter((tool) => tool.available(state)).map((tool) => tool.name),
      )

      for (const [name, registration] of this.registrations) {
        if (shouldBeRegistered.has(name)) continue
        registration.controller.abort()
        await registration.settled.catch(() => {})
        this.registrations.delete(name)
      }

      for (const tool of this.tools) {
        if (!shouldBeRegistered.has(tool.name)) continue
        if (this.registrations.has(tool.name)) continue
        this.register(tool)
      }
    } finally {
      this.syncing = false
      if (this.resyncQueued) {
        this.resyncQueued = false
        await this.sync()
      }
    }
  }

  private register(tool: ToolSpec): void {
    const controller = new AbortController()

    const settled = this.options.modelContext
      .registerTool(
        {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: async (input, { signal }) => {
            // Withdrawing a tool withdraws its calls in flight as well, so a
            // prompt waiting on the person closes when the tool it belongs to
            // is gone. Nothing else reads the signal, so a call that has
            // already done its work is unaffected.
            const outcome = await runTool(tool, this.options.workspace, input, {
              signal: signal
                ? AbortSignal.any([signal, controller.signal])
                : controller.signal,
            })
            return outcome.payload
          },
        },
        {
          signal: controller.signal,
          ...(this.options.exposedTo ? { exposedTo: this.options.exposedTo } : {}),
        },
      )
      .catch((error: unknown) => {
        // A failed registration must not leave a phantom entry behind, or the
        // tool can never be retried.
        this.registrations.delete(tool.name)
        this.options.onError?.(tool.name, error)
      })

    this.registrations.set(tool.name, { controller, settled })
  }
}
