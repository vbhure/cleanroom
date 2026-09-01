import type { ModelContext } from './types'

/**
 * How WebMCP is reaching this page.
 *
 * - `native`   the browser implements WebMCP (Chrome 149+ / Edge 150+ with the
 *              origin trial or test flag, ChatGPT Desktop's in-app browser).
 * - `polyfill` the browser does not, and Cleanroom installed the reference
 *              polyfill so every tool remains callable from the in-app Tool
 *              Inspector. Agents outside the page cannot see these tools.
 * - `none`     neither is available (should not happen in practice).
 */
export type WebMcpMode = 'native' | 'polyfill' | 'none'

/** Marker set by the loader when the reference polyfill has been installed. */
export const POLYFILL_MARKER = '__cleanroomWebMcpPolyfill' as const

declare global {
  interface Window {
    [POLYFILL_MARKER]?: true
  }
}

export interface WebMcpEnvironment {
  mode: WebMcpMode
  /** True when tools registered here are reachable by an out-of-page agent. */
  agentReachable: boolean
  modelContext: ModelContext | undefined
}

/**
 * Detects the WebMCP environment. Pure and side-effect free so it can be
 * exercised directly in unit tests.
 */
export function detectWebMcpEnvironment(
  doc: Document = document,
  win: Window = window,
): WebMcpEnvironment {
  const modelContext = doc.modelContext

  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return { mode: 'none', agentReachable: false, modelContext: undefined }
  }

  const isPolyfill = win[POLYFILL_MARKER] === true

  return {
    mode: isPolyfill ? 'polyfill' : 'native',
    agentReachable: !isPolyfill,
    modelContext,
  }
}

/** Short, user-facing summary of the detected environment. */
export function describeEnvironment(env: WebMcpEnvironment): string {
  switch (env.mode) {
    case 'native':
      return 'Native WebMCP detected — an agent in this browser can use these tools.'
    case 'polyfill':
      return 'This browser has no native WebMCP. Running the reference polyfill: every tool still works from the Tool Inspector below.'
    case 'none':
      return 'WebMCP is unavailable in this browser.'
  }
}
