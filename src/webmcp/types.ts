/**
 * TypeScript translation of the WebMCP Web IDL.
 *
 * Source of truth: https://github.com/webmachinelearning/webmcp (index.bs).
 * Kept deliberately faithful to the spec so that divergence between our code
 * and the standard is visible rather than silently absorbed.
 */

export interface ToolAnnotations {
  /** Tool does not modify state. Helps agents decide when confirmation is needed. */
  readOnlyHint?: boolean
  /** Tool output contains data the page author does not vouch for. */
  untrustedContentHint?: boolean
}

export interface ToolExecuteCallbackOptions {
  signal: AbortSignal
}

export type ToolExecuteCallback = (
  inputObject: Record<string, unknown>,
  options: ToolExecuteCallbackOptions,
) => Promise<unknown> | unknown

export interface ModelContextTool {
  /** Unique identifier used by agents to reference the tool. */
  name: string
  /** Human-facing label, used by the user agent's own UI. */
  title?: string
  /** Natural-language description of what the tool does and when to use it. */
  description: string
  /** JSON Schema describing the expected input parameters. */
  inputSchema?: object
  execute: ToolExecuteCallback
  annotations?: ToolAnnotations
}

export interface ModelContextRegisterToolOptions {
  /** Origins permitted to discover and call this tool. Omit for same-origin only. */
  exposedTo?: string[]
  /** Unregisters the tool when aborted. */
  signal?: AbortSignal
}

export interface ModelContextGetToolOptions {
  fromOrigins?: string[]
}

export interface ModelContextExecuteToolOptions {
  signal?: AbortSignal
}

export interface RegisteredTool {
  name: string
  title?: string
  description: string
  inputSchema?: object
  window: Window
  origin: string
  annotations?: ToolAnnotations
}

export interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions,
  ): Promise<void>
  getTools(options?: ModelContextGetToolOptions): Promise<RegisteredTool[]>
  /** Resolves to the JSON-stringified return value of the tool's execute callback. */
  executeTool(
    tool: RegisteredTool,
    inputObject?: Record<string, unknown>,
    options?: ModelContextExecuteToolOptions,
  ): Promise<string>
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null
}

declare global {
  interface Document {
    readonly modelContext?: ModelContext
  }
}
