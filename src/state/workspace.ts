/**
 * The workspace store.
 *
 * One mutable object, plain subscriptions, no framework. It is the single
 * surface that humans and agents both act on: a chart added by a tool call and
 * a chart added by a click are the same kind of block, and the human can edit
 * or delete either.
 *
 * Three pieces of state exist purely to keep the agent honest:
 *   `minGroupSize`  the k-anonymity threshold, set by the human
 *   `trustLevel`    how much of the data the tool surface may derive from —
 *                   moving it registers and withdraws WebMCP tools live
 *   `egress`        an itemised log of everything an agent has received
 */

import type { Dataset } from '../data/types'
import type { Aggregation, Filter, OrderBy } from '../data/query'

export type Author = 'human' | 'agent'

/**
 * The trust dial. Each position is a policy about what may leave the data:
 *   `sealed`      nothing derived from it — the agent sees structure and can
 *                 write to the report, but every analysis tool is withdrawn
 *   `aggregates`  counts, sums, averages and the like; never a record
 *   `raw`         up to a few raw rows, each release approved by the human
 *
 * The level is read by the tool layer on every call and cannot be set by a
 * tool argument. It is ordered: `raw` permits everything `aggregates` does.
 */
export type TrustLevel = 'sealed' | 'aggregates' | 'raw'

export const TRUST_LEVELS: readonly TrustLevel[] = ['sealed', 'aggregates', 'raw']

const TRUST_RANK: Record<TrustLevel, number> = { sealed: 0, aggregates: 1, raw: 2 }

/** Whether `level` is at least as permissive as `required`. */
export function trustAllows(level: TrustLevel, required: TrustLevel): boolean {
  return TRUST_RANK[level] >= TRUST_RANK[required]
}

export function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && (TRUST_LEVELS as readonly string[]).includes(value)
}

export type ChartType = 'bar' | 'line'

export interface ChartSpec {
  dataset: string
  type: ChartType
  groupBy: string
  aggregate: Aggregation
  orderBy?: OrderBy
  limit?: number
}

export interface ChartBlock {
  id: string
  kind: 'chart'
  title: string
  spec: ChartSpec
  author: Author
  createdAt: number
}

export interface NoteBlock {
  id: string
  kind: 'note'
  title?: string
  markdown: string
  author: Author
  createdAt: number
}

export type ReportBlock = ChartBlock | NoteBlock

/** Risk class of a tool call, mirrored into the ledger for the human to scan. */
export type RiskClass = 'read' | 'write' | 'gated'

export interface EgressEntry {
  id: string
  at: number
  tool: string
  risk: RiskClass
  /** Characters of JSON the agent received. */
  characters: number
  /** Raw data rows released. Non-zero only for approved sample_rows calls. */
  rowsReleased: number
  summary: string
  truncated: boolean
}

export interface ApprovalRequest {
  id: string
  tool: string
  /** One line explaining exactly what will be released if approved. */
  question: string
  detail?: Record<string, unknown>
  risk: RiskClass
}

export interface WorkspaceState {
  datasets: Dataset[]
  blocks: ReportBlock[]
  /** Dataset id -> filter applied to that dataset's charts. */
  filters: Record<string, Filter[]>
  /** Groups smaller than this are suppressed in every grouped result. */
  minGroupSize: number
  /** The trust dial. Decides which tools are registered at all. */
  trustLevel: TrustLevel
  egress: EgressEntry[]
  pendingApproval: ApprovalRequest | null
}

const INITIAL_STATE: WorkspaceState = {
  datasets: [],
  blocks: [],
  filters: {},
  minGroupSize: 1,
  trustLevel: 'aggregates',
  egress: [],
  pendingApproval: null,
}

/** Keeps the ledger bounded; the newest entries are the ones anyone reads. */
export const MAX_EGRESS_ENTRIES = 200

/** How long a tool waits for a human decision before giving up. */
export const APPROVAL_TIMEOUT_MS = 120_000

let idCounter = 0

export function createId(prefix: string): string {
  idCounter += 1
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)

  return `${prefix}_${idCounter}_${random}`
}

type Listener = () => void

export class WorkspaceStore {
  private state: WorkspaceState = INITIAL_STATE
  private readonly listeners = new Set<Listener>()
  private approvalResolver: ((approved: boolean) => void) | null = null

  getState = (): WorkspaceState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private commit(next: WorkspaceState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  // --- datasets -------------------------------------------------------------

  addDataset(dataset: Dataset): void {
    this.commit({ ...this.state, datasets: [...this.state.datasets, dataset] })
  }

  getDataset(id: string): Dataset | undefined {
    return this.state.datasets.find((dataset) => dataset.id === id)
  }

  datasetIds(): string[] {
    return this.state.datasets.map((dataset) => dataset.id)
  }

  removeDataset(id: string): void {
    const { [id]: _removed, ...filters } = this.state.filters

    this.commit({
      ...this.state,
      datasets: this.state.datasets.filter((dataset) => dataset.id !== id),
      // Blocks that charted the removed dataset would render nothing.
      blocks: this.state.blocks.filter(
        (block) => block.kind !== 'chart' || block.spec.dataset !== id,
      ),
      filters,
    })
  }

  /** Clears datasets, report and filters. The ledger is deliberately kept. */
  clearWorkspace(): { datasets: number; blocks: number } {
    const removed = {
      datasets: this.state.datasets.length,
      blocks: this.state.blocks.length,
    }

    this.commit({
      ...this.state,
      datasets: [],
      blocks: [],
      filters: {},
      pendingApproval: null,
    })

    return removed
  }

  // --- report blocks --------------------------------------------------------

  addBlock(block: ReportBlock): ReportBlock {
    this.commit({ ...this.state, blocks: [...this.state.blocks, block] })
    return block
  }

  getBlock(id: string): ReportBlock | undefined {
    return this.state.blocks.find((block) => block.id === id)
  }

  updateBlock(
    id: string,
    patch: Partial<Pick<NoteBlock, 'title' | 'markdown'>> &
      Partial<Pick<ChartBlock, 'title'>>,
  ): ReportBlock | undefined {
    const existing = this.getBlock(id)
    if (!existing) return undefined

    const updated: ReportBlock =
      existing.kind === 'note'
        ? {
            ...existing,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.markdown !== undefined ? { markdown: patch.markdown } : {}),
          }
        : {
            ...existing,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
          }

    this.commit({
      ...this.state,
      blocks: this.state.blocks.map((block) => (block.id === id ? updated : block)),
    })

    return updated
  }

  removeBlock(id: string): boolean {
    if (!this.getBlock(id)) return false

    this.commit({
      ...this.state,
      blocks: this.state.blocks.filter((block) => block.id !== id),
    })
    return true
  }

  // --- filters and guardrails ----------------------------------------------

  setFilter(datasetId: string, filters: Filter[] | null): void {
    const next = { ...this.state.filters }
    if (filters === null || filters.length === 0) delete next[datasetId]
    else next[datasetId] = filters

    this.commit({ ...this.state, filters: next })
  }

  getFilter(datasetId: string): Filter[] {
    return this.state.filters[datasetId] ?? []
  }

  setMinGroupSize(size: number): void {
    this.commit({ ...this.state, minGroupSize: Math.max(1, Math.trunc(size)) })
  }

  setTrustLevel(level: TrustLevel): void {
    if (!isTrustLevel(level)) return
    this.commit({ ...this.state, trustLevel: level })
  }

  // --- egress ledger --------------------------------------------------------

  recordEgress(entry: Omit<EgressEntry, 'id' | 'at'>): EgressEntry {
    const full: EgressEntry = { ...entry, id: createId('egress'), at: Date.now() }
    const egress = [full, ...this.state.egress].slice(0, MAX_EGRESS_ENTRIES)

    this.commit({ ...this.state, egress })
    return full
  }

  totalCharactersReleased(): number {
    return this.state.egress.reduce((total, entry) => total + entry.characters, 0)
  }

  totalRowsReleased(): number {
    return this.state.egress.reduce((total, entry) => total + entry.rowsReleased, 0)
  }

  /** Bytes of source data held in this tab — the other side of the ledger. */
  totalBytesKeptLocal(): number {
    return this.state.datasets.reduce((total, dataset) => total + dataset.sourceBytes, 0)
  }

  // --- human approval -------------------------------------------------------

  /**
   * Blocks the calling tool until the human answers, the wait times out, or the
   * agent aborts. Only one request can be outstanding: a second arriving while
   * one is pending is denied rather than queued, so an agent cannot bury a
   * dangerous prompt behind a harmless one.
   */
  requestApproval(
    request: Omit<ApprovalRequest, 'id'>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<boolean> {
    if (this.state.pendingApproval) return Promise.resolve(false)
    if (options.signal?.aborted) return Promise.resolve(false)

    const pending: ApprovalRequest = { ...request, id: createId('approval') }

    return new Promise<boolean>((resolve) => {
      let settled = false

      const finish = (approved: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        this.approvalResolver = null
        this.commit({ ...this.state, pendingApproval: null })
        resolve(approved)
      }

      const onAbort = () => finish(false)
      const timer = setTimeout(
        () => finish(false),
        options.timeoutMs ?? APPROVAL_TIMEOUT_MS,
      )

      this.approvalResolver = finish
      options.signal?.addEventListener('abort', onAbort, { once: true })

      this.commit({ ...this.state, pendingApproval: pending })
    })
  }

  /** Called by the UI when the human answers the modal. */
  resolveApproval(approved: boolean): void {
    this.approvalResolver?.(approved)
  }

  // --- testing --------------------------------------------------------------

  /** Resets everything, including the ledger. Used by tests. */
  reset(): void {
    this.approvalResolver = null
    this.commit(INITIAL_STATE)
  }
}

/** The application's single store instance. */
export const workspace = new WorkspaceStore()
