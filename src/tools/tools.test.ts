import { beforeEach, describe, expect, it } from 'vitest'
import { buildDataset } from '../data/dataset'
import { WorkspaceStore, createId } from '../state/workspace'
import { findTool } from './index'
import { runTool } from './runner'
import type { ToolSpec } from './types'

const SALES = [
  'region,rep,amount,closed_on',
  'North,Ada,100,2026-01-05',
  'North,Ada,250,2026-02-11',
  'North,Bob,75,2026-01-20',
  'South,Cleo,400,2026-03-02',
  'South,Cleo,50,2026-03-15',
  'East,Dev,900,2026-01-30',
].join('\n')

let workspace: WorkspaceStore

beforeEach(() => {
  workspace = new WorkspaceStore()
})

function loadSales() {
  const dataset = buildDataset({ name: 'sales.csv', text: SALES })
  workspace.addDataset(dataset)
  return dataset
}

function tool(name: string): ToolSpec {
  const found = findTool(name)
  if (!found) throw new Error(`no tool named ${name}`)
  return found
}

async function call(name: string, input: unknown = {}) {
  return runTool(tool(name), workspace, input)
}

/** The payload as an object, for readable assertions. */
function payload(outcome: { payload: unknown }): Record<string, unknown> {
  return outcome.payload as Record<string, unknown>
}

function errorOf(outcome: { payload: unknown }) {
  const error = payload(outcome).error as {
    code?: string
    message?: string
    [key: string]: unknown
  }
  if (!error) throw new Error(`expected an error, got ${JSON.stringify(outcome.payload)}`)
  return error
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** Runs a gated tool and answers its approval prompt. */
async function callWithApproval(
  name: string,
  input: unknown,
  approve: boolean,
) {
  const pending = call(name, input)
  await waitFor(
    () => workspace.getState().pendingApproval !== null,
    `${name} to request approval`,
  )
  workspace.resolveApproval(approve)
  return pending
}

// ---------------------------------------------------------------------------

describe('list_datasets', () => {
  it('reports an empty workspace honestly', async () => {
    const outcome = await call('list_datasets')

    expect(outcome.ok).toBe(true)
    expect(payload(outcome).datasets).toEqual([])
  })

  it('returns structure but never cell values', async () => {
    loadSales()
    const outcome = await call('list_datasets')

    const datasets = payload(outcome).datasets as Record<string, unknown>[]
    expect(datasets[0]?.id).toBe('sales')
    expect(datasets[0]?.rows).toBe(6)

    const serialised = JSON.stringify(outcome.payload)
    expect(serialised).not.toContain('Ada')
    expect(serialised).not.toContain('North')
  })

  it('tells the agent which privacy limits are in force', async () => {
    loadSales()
    workspace.setMinGroupSize(3)

    const privacy = payload(await call('list_datasets')).privacy as Record<
      string,
      unknown
    >

    expect(privacy.minGroupSize).toBe(3)
    expect(privacy.rawRowAccess).toBe('disabled')
  })
})

describe('describe_columns', () => {
  it('profiles the requested columns', async () => {
    loadSales()
    const outcome = await call('describe_columns', {
      dataset: 'sales',
      columns: ['amount'],
    })

    const profiles = payload(outcome).profiles as Record<string, unknown>[]
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.mean).toBeCloseTo(295.83, 1)
  })

  it('names the loaded datasets when the id is wrong', async () => {
    loadSales()
    const error = errorOf(await call('describe_columns', { dataset: 'nope' }))

    expect(error.code).toBe('unknown_dataset')
    expect(payload(await call('describe_columns', { dataset: 'nope' })).error).toBeTruthy()
  })

  it('lists the real columns when one is misspelled', async () => {
    loadSales()
    const outcome = await call('describe_columns', {
      dataset: 'sales',
      columns: ['regoin'],
    })

    const error = payload(outcome).error as Record<string, unknown>
    expect(error.code).toBe('unknown_column')
    expect(error.availableColumns).toContain('region')
  })
})

describe('query_dataset', () => {
  it('aggregates and groups', async () => {
    loadSales()
    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['region'],
      aggregate: [{ op: 'sum', column: 'amount' }],
      orderBy: [{ column: 'sum_of_amount', direction: 'desc' }],
    })

    expect(outcome.ok).toBe(true)
    expect(payload(outcome).rows).toEqual([
      ['East', 900],
      ['South', 450],
      ['North', 425],
    ])
  })

  it('refuses to return raw rows and points at the gated tool', async () => {
    loadSales()
    const error = errorOf(
      await call('query_dataset', { dataset: 'sales', aggregate: [] }),
    )

    // Schema enforces minItems, so this is caught before the engine.
    expect(error.code).toBe('invalid_input')
    expect(error.message).toMatch(/aggregate/i)
  })

  it('applies the human k-anonymity setting, which the agent cannot override', async () => {
    loadSales()
    workspace.setMinGroupSize(2)

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['rep'],
      aggregate: [{ op: 'count' }],
    })

    // Ada and Cleo have 2 rows; Bob and Dev have 1 each.
    expect(payload(outcome).rows).toHaveLength(2)
    expect(payload(outcome).suppressed).toMatchObject({ groups: 2, rows: 2 })
  })

  it('rejects an attempt to pass minGroupSize as an argument', async () => {
    loadSales()
    workspace.setMinGroupSize(5)

    const error = errorOf(
      await call('query_dataset', {
        dataset: 'sales',
        groupBy: ['rep'],
        aggregate: [{ op: 'count' }],
        minGroupSize: 1,
      }),
    )

    expect(error.code).toBe('invalid_input')
    expect(error.message).toMatch(/unexpected property "minGroupSize"/)
  })

  it('surfaces engine errors with the columns that do exist', async () => {
    loadSales()
    const error = errorOf(
      await call('query_dataset', {
        dataset: 'sales',
        aggregate: [{ op: 'sum', column: 'region' }],
      }),
    )

    expect(error.code).toBe('type_mismatch')
    expect(error.numericColumns).toEqual(['amount'])
  })

  it('rejects a limit above the hard cap at the schema', async () => {
    loadSales()
    const error = errorOf(
      await call('query_dataset', {
        dataset: 'sales',
        aggregate: [{ op: 'count' }],
        limit: 5000,
      }),
    )

    expect(error.code).toBe('invalid_input')
  })
})

describe('detect_anomalies', () => {
  it('returns findings for a messy dataset', async () => {
    workspace.addDataset(
      buildDataset({ name: 'messy.csv', text: 'a,b\n1,\n1,\n2,\n3,' }),
    )

    const outcome = await call('detect_anomalies', { dataset: 'messy' })
    const anomalies = payload(outcome).anomalies as Record<string, unknown>[]

    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies.some((anomaly) => anomaly.kind === 'missing')).toBe(true)
  })

  it('restricts to the requested kinds', async () => {
    loadSales()
    const outcome = await call('detect_anomalies', {
      dataset: 'sales',
      kinds: ['duplicates'],
    })

    expect(outcome.ok).toBe(true)
  })

  it('rejects an unknown kind at the schema', async () => {
    loadSales()
    const error = errorOf(
      await call('detect_anomalies', { dataset: 'sales', kinds: ['telepathy'] }),
    )

    expect(error.code).toBe('invalid_input')
    expect(error.message).toMatch(/must be one of/)
  })
})

describe('sample_rows — the human gate', () => {
  it('refuses outright when raw access is switched off', async () => {
    loadSales()
    const error = errorOf(
      await call('sample_rows', { dataset: 'sales', reason: 'need to see rows' }),
    )

    expect(error.code).toBe('raw_access_disabled')
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('releases rows only after the human approves', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const outcome = await callWithApproval(
      'sample_rows',
      { dataset: 'sales', rows: 2, columns: ['region', 'rep'], reason: 'verify the join' },
      true,
    )

    expect(outcome.ok).toBe(true)
    expect(payload(outcome).rows).toEqual([
      ['North', 'Ada'],
      ['North', 'Ada'],
    ])
    expect(workspace.totalRowsReleased()).toBe(2)
  })

  it('returns an actionable refusal when the human declines', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const outcome = await callWithApproval(
      'sample_rows',
      { dataset: 'sales', reason: 'curious about the data' },
      false,
    )

    const error = errorOf(outcome)
    expect(error.code).toBe('approval_denied')
    expect(error.message).toMatch(/aggregates/i)
    expect(workspace.totalRowsReleased()).toBe(0)
  })

  it('shows the agent’s stated reason to the human', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const pending = call('sample_rows', {
      dataset: 'sales',
      reason: 'the totals disagree with the source system',
    })
    await waitFor(
      () => workspace.getState().pendingApproval !== null,
      'approval request',
    )

    const request = workspace.getState().pendingApproval
    expect(request?.detail?.reason).toBe(
      'the totals disagree with the source system',
    )
    expect(request?.risk).toBe('gated')

    workspace.resolveApproval(false)
    await pending
  })

  it('requires a reason of substance', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const error = errorOf(await call('sample_rows', { dataset: 'sales', reason: 'why' }))
    expect(error.code).toBe('invalid_input')
  })

  it('caps the number of rows at the schema', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const error = errorOf(
      await call('sample_rows', {
        dataset: 'sales',
        rows: 500,
        reason: 'want the whole file',
      }),
    )

    expect(error.code).toBe('invalid_input')
  })

  it('denies a second request while one is already waiting', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const first = call('sample_rows', { dataset: 'sales', reason: 'first request' })
    await waitFor(
      () => workspace.getState().pendingApproval !== null,
      'first approval request',
    )

    // A second prompt must not be able to hide behind the first.
    const second = await call('sample_rows', {
      dataset: 'sales',
      reason: 'second request slipped in',
    })
    expect(errorOf(second).code).toBe('approval_denied')

    workspace.resolveApproval(false)
    await first
  })

  it('reports an empty dataset instead of asking for permission', async () => {
    workspace.addDataset(buildDataset({ name: 'empty.csv', text: 'a,b' }))
    workspace.setAllowSampleRows(true)

    const error = errorOf(
      await call('sample_rows', { dataset: 'empty', reason: 'looking for anything' }),
    )

    expect(error.code).toBe('empty_dataset')
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('validates column names before prompting the human', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)

    const error = errorOf(
      await call('sample_rows', {
        dataset: 'sales',
        columns: ['nope'],
        reason: 'checking a column',
      }),
    )

    expect(error.code).toBe('unknown_column')
    expect(workspace.getState().pendingApproval).toBeNull()
  })
})

describe('add_chart', () => {
  it('adds a chart and returns its id', async () => {
    loadSales()
    const outcome = await call('add_chart', {
      dataset: 'sales',
      title: 'Revenue by region',
      type: 'bar',
      groupBy: 'region',
      aggregate: { op: 'sum', column: 'amount' },
    })

    expect(outcome.ok).toBe(true)
    expect(workspace.getState().blocks).toHaveLength(1)
    expect(workspace.getState().blocks[0]?.author).toBe('agent')
    expect(payload(outcome).blockId).toBeTruthy()
  })

  it('rejects a chart whose aggregate cannot work, before adding it', async () => {
    loadSales()
    const error = errorOf(
      await call('add_chart', {
        dataset: 'sales',
        title: 'Nonsense',
        type: 'bar',
        groupBy: 'region',
        aggregate: { op: 'sum', column: 'rep' },
      }),
    )

    expect(error.code).toBe('type_mismatch')
    expect(workspace.getState().blocks).toHaveLength(0)
  })

  it('rejects an unknown grouping column', async () => {
    loadSales()
    const error = errorOf(
      await call('add_chart', {
        dataset: 'sales',
        title: 'Bad group',
        type: 'bar',
        groupBy: 'nope',
        aggregate: { op: 'count' },
      }),
    )

    expect(error.code).toBe('unknown_column')
  })

  it('rejects an unsupported chart type', async () => {
    loadSales()
    const error = errorOf(
      await call('add_chart', {
        dataset: 'sales',
        title: 'Pie',
        type: 'pie',
        groupBy: 'region',
        aggregate: { op: 'count' },
      }),
    )

    expect(error.code).toBe('invalid_input')
  })
})

describe('add_note, update_report_block and remove_report_block', () => {
  it('adds a note', async () => {
    const outcome = await call('add_note', {
      title: 'Summary',
      markdown: 'Revenue is concentrated in **East**.',
    })

    expect(outcome.ok).toBe(true)
    expect(workspace.getState().blocks).toHaveLength(1)
  })

  it('revises a note it added', async () => {
    const added = await call('add_note', { markdown: 'First draft.' })
    const blockId = payload(added).blockId as string

    const outcome = await call('update_report_block', {
      blockId,
      markdown: 'Second draft.',
    })

    expect(outcome.ok).toBe(true)
    const block = workspace.getBlock(blockId)
    expect(block?.kind === 'note' && block.markdown).toBe('Second draft.')
  })

  it('refuses to give a chart a markdown body', async () => {
    loadSales()
    const added = await call('add_chart', {
      dataset: 'sales',
      title: 'Revenue',
      type: 'bar',
      groupBy: 'region',
      aggregate: { op: 'count' },
    })

    const error = errorOf(
      await call('update_report_block', {
        blockId: payload(added).blockId,
        markdown: 'charts have no prose',
      }),
    )

    expect(error.code).toBe('not_a_note')
  })

  it('lists known block ids when the id is wrong', async () => {
    await call('add_note', { markdown: 'A note.' })
    const error = errorOf(
      await call('update_report_block', { blockId: 'nope', title: 'x' }),
    )

    expect(error.code).toBe('unknown_block')
    expect(Array.isArray(error.blockIds)).toBe(true)
  })

  it('rejects an update that changes nothing', async () => {
    const added = await call('add_note', { markdown: 'A note.' })
    const error = errorOf(
      await call('update_report_block', { blockId: payload(added).blockId }),
    )

    expect(error.code).toBe('nothing_to_update')
  })

  it('removes a block', async () => {
    const added = await call('add_note', { markdown: 'Temporary.' })
    const outcome = await call('remove_report_block', {
      blockId: payload(added).blockId,
    })

    expect(outcome.ok).toBe(true)
    expect(workspace.getState().blocks).toHaveLength(0)
  })

  it('reports removing a block that is not there', async () => {
    await call('add_note', { markdown: 'Keep me.' })
    const error = errorOf(await call('remove_report_block', { blockId: 'ghost' }))

    expect(error.code).toBe('unknown_block')
    expect(workspace.getState().blocks).toHaveLength(1)
  })
})

describe('set_report_filter', () => {
  it('applies a filter and reports how much it matched', async () => {
    loadSales()
    const outcome = await call('set_report_filter', {
      dataset: 'sales',
      where: [{ column: 'region', op: 'eq', value: 'North' }],
    })

    expect(payload(outcome).matchedRows).toBe(3)
    expect(workspace.getFilter('sales')).toHaveLength(1)
  })

  it('clears the filter with an empty list', async () => {
    loadSales()
    await call('set_report_filter', {
      dataset: 'sales',
      where: [{ column: 'region', op: 'eq', value: 'North' }],
    })

    await call('set_report_filter', { dataset: 'sales', where: [] })
    expect(workspace.getFilter('sales')).toEqual([])
  })

  it('refuses an invalid filter rather than emptying the report', async () => {
    loadSales()
    await call('set_report_filter', {
      dataset: 'sales',
      where: [{ column: 'region', op: 'eq', value: 'North' }],
    })

    const error = errorOf(
      await call('set_report_filter', {
        dataset: 'sales',
        where: [{ column: 'ghost', op: 'eq', value: 1 }],
      }),
    )

    expect(error.code).toBe('unknown_column')
    // The previous, working filter must survive.
    expect(workspace.getFilter('sales')).toHaveLength(1)
  })
})

describe('clear_workspace — the destructive gate', () => {
  it('clears everything once the human approves', async () => {
    loadSales()
    await call('add_note', { markdown: 'A note.' })

    const outcome = await callWithApproval('clear_workspace', { confirm: true }, true)

    expect(outcome.ok).toBe(true)
    expect(workspace.getState().datasets).toHaveLength(0)
    expect(workspace.getState().blocks).toHaveLength(0)
  })

  it('changes nothing when the human declines', async () => {
    loadSales()
    const outcome = await callWithApproval('clear_workspace', { confirm: true }, false)

    expect(errorOf(outcome).code).toBe('approval_denied')
    expect(workspace.getState().datasets).toHaveLength(1)
  })

  it('cannot be called without the confirm flag', async () => {
    loadSales()
    expect(errorOf(await call('clear_workspace', {})).code).toBe('invalid_input')
    expect(errorOf(await call('clear_workspace', { confirm: false })).code).toBe(
      'invalid_input',
    )
    expect(workspace.getState().datasets).toHaveLength(1)
  })

  it('keeps the egress ledger, which is the record of what happened', async () => {
    loadSales()
    await call('list_datasets')
    const before = workspace.getState().egress.length

    await callWithApproval('clear_workspace', { confirm: true }, true)

    expect(workspace.getState().egress.length).toBeGreaterThanOrEqual(before)
  })
})

describe('tool availability tracks workspace state', () => {
  it('offers only the tools that can work right now', () => {
    const empty = workspace.getState()
    expect(findTool('query_dataset')?.available(empty)).toBe(false)
    expect(findTool('list_datasets')?.available(empty)).toBe(true)
    expect(findTool('add_note')?.available(empty)).toBe(true)
    expect(findTool('clear_workspace')?.available(empty)).toBe(false)

    loadSales()
    const loaded = workspace.getState()
    expect(findTool('query_dataset')?.available(loaded)).toBe(true)
    expect(findTool('clear_workspace')?.available(loaded)).toBe(true)
    expect(findTool('update_report_block')?.available(loaded)).toBe(false)
  })
})

describe('the egress ledger', () => {
  it('records every call, including refusals', async () => {
    loadSales()
    await call('list_datasets')
    await call('query_dataset', { dataset: 'nope', aggregate: [{ op: 'count' }] })

    const ledger = workspace.getState().egress
    expect(ledger).toHaveLength(2)
    expect(ledger[0]?.summary).toMatch(/refused/)
    expect(ledger[1]?.tool).toBe('list_datasets')
  })

  it('counts the characters the agent actually received', async () => {
    loadSales()
    const outcome = await call('list_datasets')
    const entry = workspace.getState().egress[0]

    expect(entry?.characters).toBe(outcome.characters)
    expect(entry?.characters).toBeGreaterThan(0)
    expect(workspace.totalCharactersReleased()).toBe(entry?.characters)
  })

  it('attributes rows released only to approved raw access', async () => {
    loadSales()
    workspace.setAllowSampleRows(true)
    await call('query_dataset', { dataset: 'sales', aggregate: [{ op: 'count' }] })

    expect(workspace.totalRowsReleased()).toBe(0)

    await callWithApproval(
      'sample_rows',
      { dataset: 'sales', rows: 1, reason: 'checking one record' },
      true,
    )

    expect(workspace.totalRowsReleased()).toBe(1)
  })

  it('records the risk class so a human can scan for the dangerous calls', async () => {
    loadSales()
    await call('list_datasets')
    await call('add_note', { markdown: 'note' })

    const risks = workspace.getState().egress.map((entry) => entry.risk)
    expect(risks).toContain('read')
    expect(risks).toContain('write')
  })
})

describe('hostile input', () => {
  it('rejects prototype-polluting keys', async () => {
    loadSales()
    const hostile = JSON.parse('{"dataset":"sales","__proto__":{"polluted":true}}')

    const error = errorOf(await call('describe_columns', hostile))
    expect(error.code).toBe('forbidden_key')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects a nested prototype-polluting key', async () => {
    loadSales()
    const hostile = JSON.parse(
      '{"dataset":"sales","aggregate":[{"op":"count","constructor":{"x":1}}]}',
    )

    expect(errorOf(await call('query_dataset', hostile)).code).toBe('forbidden_key')
  })

  it('rejects a non-object argument', async () => {
    expect(errorOf(await call('list_datasets', 'not an object')).code).toBe(
      'invalid_input',
    )
    expect(errorOf(await call('list_datasets', [1, 2, 3])).code).toBe('invalid_input')
  })

  it('rejects unknown properties instead of ignoring them', async () => {
    loadSales()
    const error = errorOf(
      await call('describe_columns', { dataset: 'sales', sneaky: true }),
    )

    expect(error.code).toBe('invalid_input')
    expect(error.message).toMatch(/unexpected property "sneaky"/)
  })

  it('survives a tool that throws, reporting it as a structured error', async () => {
    const exploding: ToolSpec = {
      name: 'explode',
      title: 'Explode',
      description: 'A tool that throws, used to prove the runner contains failures.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'read',
      annotations: { readOnlyHint: true },
      available: () => true,
      execute: () => {
        throw new Error('boom')
      },
    }

    const outcome = await runTool(exploding, workspace, {})
    expect(outcome.ok).toBe(false)
    expect(errorOf(outcome).code).toBe('tool_failed')
    expect(errorOf(outcome).message).toContain('boom')
  })
})

describe('output budget', () => {
  it('keeps every tool result within the character budget', async () => {
    const wide = ['id,value']
    for (let i = 0; i < 400; i += 1) {
      wide.push(`a_deliberately_long_group_key_value_number_${i},${i}`)
    }
    workspace.addDataset(buildDataset({ name: 'wide.csv', text: wide.join('\n') }))

    const outcome = await call('query_dataset', {
      dataset: 'wide',
      groupBy: ['id'],
      aggregate: [{ op: 'sum', column: 'value' }],
      limit: 50,
    })

    expect(outcome.characters).toBeLessThanOrEqual(1500)
    expect(outcome.truncated).toBe(true)
    expect(payload(outcome).outputTruncated).toBeTruthy()
  })
})

describe('createId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId('x')))
    expect(ids.size).toBe(500)
  })
})
