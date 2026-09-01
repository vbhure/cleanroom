/**
 * Tools that write to the shared report.
 *
 * These are the collaboration surface: a chart added by an agent and a chart
 * added by a click are the same kind of block, appear in the same place, and
 * the human can edit or delete either. Every write is reversible, and every
 * block records who made it.
 *
 * `clear_workspace` is the one destructive tool. It requires an explicit
 * confirm flag *and* a human decision, because losing a loaded dataset means
 * the person has to go and find their file again.
 */

import { runQuery } from '../data/query'
import type { Aggregation, Filter, OrderBy } from '../data/query'
import { columnNames, findColumn } from '../data/types'
import type { ChartSpec, ChartType, WorkspaceState } from '../state/workspace'
import { createId, trustAllows } from '../state/workspace'
import { MAX_LIST_ITEMS, resolveDataset } from './dataTools'
import type { JsonSchema, ToolSpec } from './types'
import { fail } from './types'

/** Longest note an agent may write. Notes are prose, not data dumps. */
export const MAX_NOTE_CHARACTERS = 2000

const AGGREGATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median'],
      description: 'Aggregate to plot.',
    },
    column: {
      type: 'string',
      description: 'Column to aggregate. Required for every op except count.',
    },
  },
  required: ['op'],
  additionalProperties: false,
}

const FILTER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    column: { type: 'string', description: 'Column to filter on.' },
    op: {
      type: 'string',
      enum: [
        'eq',
        'ne',
        'gt',
        'gte',
        'lt',
        'lte',
        'contains',
        'starts_with',
        'in',
        'is_null',
        'is_not_null',
      ],
      description: 'Comparison to apply.',
    },
    value: {
      description:
        'Value to compare against. Omit for is_null and is_not_null. Use an array for in.',
    },
  },
  required: ['column', 'op'],
  additionalProperties: false,
}

const hasDataset = (state: WorkspaceState) => state.datasets.length > 0
/** add_chart and set_report_filter both report aggregate counts back. */
const readsAggregates = (state: WorkspaceState) =>
  hasDataset(state) && trustAllows(state.trustLevel, 'aggregates')
const hasBlocks = (state: WorkspaceState) => state.blocks.length > 0
const hasAnything = (state: WorkspaceState) =>
  state.datasets.length > 0 || state.blocks.length > 0

export const addChart: ToolSpec = {
  name: 'add_chart',
  title: 'Add a chart to the report',
  description:
    'Add a bar or line chart to the report the person is looking at. The chart is defined by a grouping column and an aggregate, and it recomputes from the local data, so it stays correct if the report filter changes. Returns the chart id. The person can edit or delete it afterwards.',
  risk: 'write',
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Dataset id from list_datasets.' },
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 120,
        description: 'Heading shown above the chart.',
      },
      type: {
        type: 'string',
        enum: ['bar', 'line'],
        description: 'bar for categories, line for a series over time.',
      },
      groupBy: {
        type: 'string',
        description: 'Column whose values become the categories or x-axis.',
      },
      aggregate: {
        ...AGGREGATION_SCHEMA,
        description: 'The value plotted for each group, such as a count or a sum.',
      },
      orderBy: {
        type: 'object',
        description: 'How to sort the bars or points. Defaults to group order.',
        properties: {
          column: { type: 'string', description: 'Grouped column or aggregate name.' },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['column'],
        additionalProperties: false,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum bars or points. Defaults to 20.',
      },
    },
    required: ['dataset', 'title', 'type', 'groupBy', 'aggregate'],
    additionalProperties: false,
  },
  available: readsAggregates,
  execute: (input, { workspace }) => {
    const resolved = resolveDataset(workspace, input.dataset)
    if (!resolved.ok) return resolved.failure

    const { dataset } = resolved
    const groupBy = String(input.groupBy)

    if (!findColumn(dataset, groupBy)) {
      return fail(
        'unknown_column',
        `There is no column named "${groupBy}" in "${dataset.id}".`,
        { availableColumns: columnNames(dataset) },
      )
    }

    const spec: ChartSpec = {
      dataset: dataset.id,
      type: input.type as ChartType,
      groupBy,
      aggregate: input.aggregate as Aggregation,
      orderBy: input.orderBy as OrderBy | undefined,
      limit: input.limit as number | undefined,
    }

    // Run the query now so an invalid chart is rejected with a useful message
    // instead of being added and rendering an error at the human.
    const probe = runQuery(dataset, {
      where: workspace.getFilter(dataset.id),
      groupBy: [spec.groupBy],
      aggregate: [spec.aggregate],
      orderBy: spec.orderBy ? [spec.orderBy] : undefined,
      limit: spec.limit,
      minGroupSize: workspace.getState().minGroupSize,
    })

    if (!probe.ok) {
      return fail(probe.error.code, probe.error.message, probe.error.detail ?? {})
    }

    const block = workspace.addBlock({
      id: createId('block'),
      kind: 'chart',
      title: String(input.title),
      spec,
      author: 'agent',
      createdAt: Date.now(),
    })

    return {
      payload: {
        blockId: block.id,
        plotted: probe.result.rows.length,
        totalGroups: probe.result.totalGroups,
      },
      summary: `Added chart "${block.title}" to the report (${probe.result.rows.length} points).`,
    }
  },
}

export const addNote: ToolSpec = {
  name: 'add_note',
  title: 'Add a note to the report',
  description:
    'Add a written note to the report — an interpretation, a caveat, or a summary of what the numbers show. Supports simple markdown: headings, bold, italic, lists, inline code and links. Returns the note id so it can be revised later.',
  risk: 'write',
  annotations: {
    readOnlyHint: false,
    // Notes routinely quote figures derived from the person's own file.
    untrustedContentHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        maxLength: 120,
        description: 'Optional heading for the note.',
      },
      markdown: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_NOTE_CHARACTERS,
        description: 'Note body. Simple markdown only.',
      },
    },
    required: ['markdown'],
    additionalProperties: false,
  },
  available: () => true,
  execute: (input, { workspace }) => {
    const block = workspace.addBlock({
      id: createId('block'),
      kind: 'note',
      ...(typeof input.title === 'string' && input.title.length > 0
        ? { title: input.title }
        : {}),
      markdown: String(input.markdown),
      author: 'agent',
      createdAt: Date.now(),
    })

    return {
      payload: { blockId: block.id },
      summary: `Added a note to the report${block.kind === 'note' && block.title ? `: "${block.title}"` : ''}.`,
    }
  },
}

export const updateReportBlock: ToolSpec = {
  name: 'update_report_block',
  title: 'Revise a report block',
  description:
    'Change the title of any report block, or the body of a note. Use this to correct or refine something already in the report rather than adding a near-duplicate. Chart definitions cannot be edited — remove the chart and add a new one.',
  risk: 'write',
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      blockId: {
        type: 'string',
        description: 'Block id returned by add_chart or add_note.',
      },
      title: { type: 'string', maxLength: 120, description: 'Replacement title.' },
      markdown: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_NOTE_CHARACTERS,
        description: 'Replacement body. Notes only.',
      },
    },
    required: ['blockId'],
    additionalProperties: false,
  },
  available: hasBlocks,
  execute: (input, { workspace }) => {
    const blockId = String(input.blockId)
    const existing = workspace.getBlock(blockId)

    if (!existing) {
      return fail('unknown_block', `There is no report block with id "${blockId}".`, {
        blockIds: workspace.getState().blocks.map((block) => block.id),
      })
    }

    if (input.title === undefined && input.markdown === undefined) {
      return fail(
        'nothing_to_update',
        'Provide a title, a markdown body, or both.',
      )
    }

    if (input.markdown !== undefined && existing.kind !== 'note') {
      return fail(
        'not_a_note',
        `Block "${blockId}" is a chart, so it has no markdown body. Only its title can be changed.`,
      )
    }

    const updated = workspace.updateBlock(blockId, {
      ...(input.title !== undefined ? { title: String(input.title) } : {}),
      ...(input.markdown !== undefined ? { markdown: String(input.markdown) } : {}),
    })

    return {
      payload: { blockId, updated: updated !== undefined },
      summary: `Revised report block "${blockId}".`,
    }
  },
}

export const removeReportBlock: ToolSpec = {
  name: 'remove_report_block',
  title: 'Remove a report block',
  description:
    'Delete one chart or note from the report. Use this to clean up a block that turned out to be wrong or redundant. The person can see exactly what was removed in the activity ledger.',
  risk: 'write',
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      blockId: {
        type: 'string',
        description: 'Block id returned by add_chart or add_note.',
      },
    },
    required: ['blockId'],
    additionalProperties: false,
  },
  available: hasBlocks,
  execute: (input, { workspace }) => {
    const blockId = String(input.blockId)
    const existing = workspace.getBlock(blockId)

    if (!existing) {
      return fail('unknown_block', `There is no report block with id "${blockId}".`, {
        blockIds: workspace.getState().blocks.map((block) => block.id),
      })
    }

    const label = existing.kind === 'chart' ? existing.title : (existing.title ?? 'note')
    workspace.removeBlock(blockId)

    return {
      payload: { blockId, removed: true },
      summary: `Removed ${existing.kind} "${label}" from the report.`,
    }
  },
}

export const setReportFilter: ToolSpec = {
  name: 'set_report_filter',
  title: 'Filter the whole report',
  description:
    'Apply a filter to every chart of one dataset at once, so the whole report narrows to a subset such as a single quarter or region. Pass an empty filter list to clear it. The filter is shown to the person, who can clear it themselves.',
  risk: 'write',
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Dataset id from list_datasets.' },
      where: {
        type: 'array',
        items: FILTER_SCHEMA,
        maxItems: MAX_LIST_ITEMS,
        description: 'Filters combined with AND. Empty array clears the filter.',
      },
    },
    required: ['dataset', 'where'],
    additionalProperties: false,
  },
  available: readsAggregates,
  execute: (input, { workspace }) => {
    const resolved = resolveDataset(workspace, input.dataset)
    if (!resolved.ok) return resolved.failure

    const filters = input.where as Filter[]

    if (filters.length === 0) {
      workspace.setFilter(resolved.dataset.id, null)
      return {
        payload: { dataset: resolved.dataset.id, filter: null },
        summary: `Cleared the report filter on "${resolved.dataset.id}".`,
      }
    }

    // Validate by running the filter, so a bad filter is rejected rather than
    // silently emptying every chart in the report. The threshold is the
    // person's, not 1: otherwise "how many rows match?" would be an exact
    // count oracle that query_dataset refuses to be.
    const minGroupSize = workspace.getState().minGroupSize
    const probe = runQuery(resolved.dataset, {
      where: filters,
      aggregate: [{ op: 'count' }],
      minGroupSize,
    })

    if (!probe.ok) {
      return fail(probe.error.code, probe.error.message, probe.error.detail ?? {})
    }

    workspace.setFilter(resolved.dataset.id, filters)

    return {
      payload: {
        dataset: resolved.dataset.id,
        ...(probe.result.matchedRowsIdentifying
          ? { matchedRows: `fewer than ${minGroupSize}` }
          : { matchedRows: probe.result.matchedRows }),
        totalRows: resolved.dataset.rowCount,
      },
      summary: `Filtered the report on "${resolved.dataset.id}" to ${probe.result.matchedRows} of ${resolved.dataset.rowCount} rows.`,
    }
  },
}

export const clearWorkspace: ToolSpec = {
  name: 'clear_workspace',
  title: 'Clear everything (needs approval)',
  description:
    'Remove every loaded dataset and every report block. This is destructive and cannot be undone — the person would have to load their file again. It always pauses for a human decision. Only call this when the person has clearly asked to start over.',
  risk: 'gated',
  annotations: { readOnlyHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      confirm: {
        type: 'boolean',
        enum: [true],
        description: 'Must be true. Acknowledges that this discards all work.',
      },
    },
    required: ['confirm'],
    additionalProperties: false,
  },
  available: hasAnything,
  execute: async (_input, { workspace, signal }) => {
    const state = workspace.getState()

    const approved = await workspace.requestApproval(
      {
        tool: 'clear_workspace',
        risk: 'gated',
        question: `Discard ${state.datasets.length} dataset${state.datasets.length === 1 ? '' : 's'} and ${state.blocks.length} report block${state.blocks.length === 1 ? '' : 's'}? This cannot be undone.`,
        detail: {
          datasets: state.datasets.map((dataset) => dataset.name),
          blocks: state.blocks.length,
        },
      },
      { signal },
    )

    if (!approved) {
      return fail(
        'approval_denied',
        'The person did not approve clearing the workspace. Nothing was changed.',
      )
    }

    const removed = workspace.clearWorkspace()

    return {
      payload: { cleared: true, ...removed },
      summary: `Human approved clearing the workspace (${removed.datasets} dataset(s), ${removed.blocks} block(s)).`,
    }
  },
}

export const REPORT_TOOLS: ToolSpec[] = [
  addChart,
  addNote,
  updateReportBlock,
  removeReportBlock,
  setReportFilter,
  clearWorkspace,
]
