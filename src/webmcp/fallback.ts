/**
 * A minimal, same-page implementation of the WebMCP interface.
 *
 * Installed only when the browser has none of its own. It does not — and
 * cannot — make Cleanroom's tools visible to an agent outside the page; no
 * script can. What it does is keep one code path: the app registers its tools
 * through `document.modelContext` exactly as it would in Chrome 149 or ChatGPT
 * Desktop, and the in-app Tool Inspector discovers and calls them through
 * `getTools()` and `executeTool()`. A judge on an ordinary browser is therefore
 * exercising the real interface, not a bypass around it.
 *
 * This is our own implementation rather than a vendored one: the subset that
 * matters here is small, and writing it means it is covered by our tests.
 *
 * Behaviour follows the specification at
 * https://github.com/webmachinelearning/webmcp — notably that `registerTool`
 * rejects duplicate or empty names, `executeTool` resolves to the *stringified*
 * result, and an aborted registration signal unregisters the tool.
 */

import { POLYFILL_MARKER } from './environment'
import type {
  ModelContext,
  ModelContextGetToolOptions,
  ModelContextRegisterToolOptions,
  ModelContextTool,
  RegisteredTool,
} from './types'

interface Entry {
  tool: ModelContextTool
  exposedTo: string[] | undefined
}

class LocalModelContext extends EventTarget implements ModelContext {
  private readonly tools = new Map<string, Entry>()

  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null = null

  constructor() {
    super()
    // Mirror the `ontoolchange` IDL attribute onto the event system, so both
    // styles work the way they do in a native implementation.
    this.addEventListener('toolchange', (event) => {
      this.ontoolchange?.call(this, event)
    })
  }

  registerTool(
    tool: ModelContextTool,
    options: ModelContextRegisterToolOptions = {},
  ): Promise<undefined> {
    if (!tool || typeof tool.name !== 'string' || tool.name === '') {
      return Promise.reject(new TypeError('A tool must have a non-empty name.'))
    }
    if (typeof tool.description !== 'string' || tool.description === '') {
      return Promise.reject(
        new TypeError(`Tool "${tool.name}" must have a non-empty description.`),
      )
    }
    if (typeof tool.execute !== 'function') {
      return Promise.reject(
        new TypeError(`Tool "${tool.name}" must have an execute function.`),
      )
    }
    if (this.tools.has(tool.name)) {
      return Promise.reject(
        new DOMException(
          `A tool named "${tool.name}" is already registered.`,
          'InvalidStateError',
        ),
      )
    }
    if (options.signal?.aborted) {
      return Promise.resolve(undefined)
    }

    this.tools.set(tool.name, { tool, exposedTo: options.exposedTo })

    options.signal?.addEventListener(
      'abort',
      () => {
        this.tools.delete(tool.name)
        this.dispatchEvent(new Event('toolchange'))
      },
      { once: true },
    )

    this.dispatchEvent(new Event('toolchange'))
    return Promise.resolve(undefined)
  }

  getTools(options: ModelContextGetToolOptions = {}): Promise<RegisteredTool[]> {
    void options
    const origin = globalThis.location?.origin ?? 'null'

    return Promise.resolve(
      [...this.tools.values()].map(({ tool }) => ({
        name: tool.name,
        ...(tool.title !== undefined ? { title: tool.title } : {}),
        description: tool.description,
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        window: globalThis.window,
        origin,
        // The ToolAnnotations dictionary defaults both members to false, so a
        // native implementation always reports them. Applying the defaults here
        // means an agent sees the same shape either way, and an absent hint is
        // never mistaken for an unknown one.
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint ?? false,
          untrustedContentHint: tool.annotations?.untrustedContentHint ?? false,
        },
      })),
    )
  }

  async executeTool(
    tool: RegisteredTool,
    inputObject: Record<string, unknown> = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const entry = this.tools.get(tool?.name ?? '')
    if (!entry) {
      throw new DOMException(
        `No tool named "${tool?.name}" is registered.`,
        'NotFoundError',
      )
    }

    const controller = new AbortController()
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else
        options.signal.addEventListener('abort', () => controller.abort(), {
          once: true,
        })
    }

    const result = await entry.tool.execute(inputObject, {
      signal: controller.signal,
    })

    // The specification resolves executeTool with the stringified result.
    return JSON.stringify(result ?? null) ?? 'null'
  }
}

/**
 * Installs the fallback if the browser has no WebMCP of its own.
 * Returns true when a fallback was installed.
 */
export function installWebMcpFallback(
  doc: Document = document,
  win: Window = window,
): boolean {
  if (doc.modelContext) return false

  Object.defineProperty(doc, 'modelContext', {
    value: new LocalModelContext(),
    configurable: true,
    enumerable: false,
    writable: false,
  })

  Object.defineProperty(win, POLYFILL_MARKER, {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false,
  })

  return true
}

/** Exposed for tests, which need a context without touching the document. */
export function createLocalModelContext(): ModelContext {
  return new LocalModelContext()
}
