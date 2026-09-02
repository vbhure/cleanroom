import { beforeEach, describe, expect, it } from 'vitest'
import { buildDataset } from '../data/dataset'
import {
  MAX_EGRESS_ENTRIES,
  WorkspaceStore,
  createId,
  isTrustLevel,
  trustAllows,
} from '../state/workspace'
import { ALL_TOOLS, findTool } from './index'
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

/**
 * Turns the k-anonymity threshold off, for tests about mechanics rather than
 * privacy. This fixture has six rows in groups of one to three, so at the
 * shipped default of five every result is suppressed — correctly, but that
 * tells us nothing about whether the aggregation itself works. What the
 * default does is asserted in "the minimum group size" below.
 *
 * The trust level has to move too. Below Raw the threshold is floored at two
 * however low the person sets it, because "Aggregates" promises never to
 * compute an answer from a single record — so a single-row group is only
 * answerable at the level where the person has accepted record access.
 */
function openThreshold() {
  workspace.setTrustLevel('raw')
  workspace.setMinGroupSize(1)
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
    expect(privacy.trustLevel).toBe('aggregates')
    expect(privacy.rawRowAccess).toBe('disabled')
  })

  it('reports the trust level the person has set', async () => {
    loadSales()
    workspace.setTrustLevel('raw')

    const privacy = payload(await call('list_datasets')).privacy as Record<
      string,
      unknown
    >

    expect(privacy.trustLevel).toBe('raw')
    expect(privacy.rawRowAccess).toBe('requires approval')
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
    openThreshold()
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

    // Ada and Cleo have 2 rows; Bob and Dev have 1 each. That suppression
    // happened is reported; how much was suppressed is not, because the counts
    // were themselves an oracle.
    expect(payload(outcome).rows).toHaveLength(2)
    expect(payload(outcome).suppressed).toMatchObject({
      reason: expect.stringContaining('2'),
    })
    expect((payload(outcome).suppressed as Record<string, unknown>).rows).toBeUndefined()
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
  it('is withdrawn, not merely refused, below the raw level', async () => {
    loadSales()
    expect(workspace.getState().trustLevel).toBe('aggregates')

    const error = errorOf(
      await call('sample_rows', { dataset: 'sales', reason: 'need to see rows' }),
    )

    expect(error.code).toBe('tool_unavailable')
    expect(error.message).toMatch(/list_datasets/)
    expect(workspace.getState().pendingApproval).toBeNull()
    expect(workspace.totalRowsReleased()).toBe(0)
  })

  it('refuses inside execute as well, in case the runner is bypassed', async () => {
    loadSales()
    const outcome = await tool('sample_rows').execute(
      { dataset: 'sales', reason: 'need to see rows' },
      { workspace, signal: new AbortController().signal },
    )

    expect('error' in outcome && outcome.error.code).toBe('raw_access_disabled')
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('will not release rows from a file the person removed while it waited', async () => {
    const dataset = loadSales()
    workspace.setTrustLevel('raw')

    const pending = call('sample_rows', {
      dataset: 'sales',
      rows: 2,
      reason: 'Checking two records before the person changes their mind.',
    })

    await waitFor(
      () => workspace.getState().pendingApproval !== null,
      'the approval prompt',
    )

    // The person takes the file off the page, then answers yes out of habit.
    workspace.removeDataset(dataset.id)
    workspace.resolveApproval(true)

    const error = errorOf(await pending)
    expect(error.code).toBe('unknown_dataset')
    expect(workspace.totalRowsReleased()).toBe(0)
  })

  it('withholds the rows if the dial is turned down while the prompt is open', async () => {
    loadSales()
    workspace.setTrustLevel('raw')

    const pending = call('sample_rows', { dataset: 'sales', reason: 'checking a record' })
    await waitFor(
      () => workspace.getState().pendingApproval !== null,
      'approval request',
    )

    // The person changes their mind about the workspace, then clicks Allow.
    // The workspace decision is the later, broader one, so it wins.
    workspace.setTrustLevel('aggregates')
    workspace.resolveApproval(true)

    const error = errorOf(await pending)
    expect(error.code).toBe('raw_access_disabled')
    expect(workspace.totalRowsReleased()).toBe(0)
  })

  it('releases rows only after the human approves', async () => {
    loadSales()
    workspace.setTrustLevel('raw')

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
    workspace.setTrustLevel('raw')

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
    workspace.setTrustLevel('raw')

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
    workspace.setTrustLevel('raw')

    const error = errorOf(await call('sample_rows', { dataset: 'sales', reason: 'why' }))
    expect(error.code).toBe('invalid_input')
  })

  it('caps the number of rows at the schema', async () => {
    loadSales()
    workspace.setTrustLevel('raw')

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
    workspace.setTrustLevel('raw')

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
    workspace.setTrustLevel('raw')

    const error = errorOf(
      await call('sample_rows', { dataset: 'empty', reason: 'looking for anything' }),
    )

    expect(error.code).toBe('empty_dataset')
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('validates column names before prompting the human', async () => {
    loadSales()
    workspace.setTrustLevel('raw')

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

describe('the minimum group size, at the tool boundary', () => {
  // The engine's suppression is unit-tested next door. What matters here is
  // that the *tools* carry the person's threshold into every path an agent can
  // reach, and that none of them quietly substitute a weaker one.

  it('ships on: a fresh workspace suppresses rather than releases', async () => {
    loadSales()

    expect(workspace.getState().minGroupSize).toBe(5)

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['rep'],
      aggregate: [{ op: 'sum', column: 'amount' }],
    })

    // Every rep has fewer than five rows, so nobody is named.
    expect(payload(outcome).rows).toEqual([])
    expect(JSON.stringify(outcome.payload)).not.toContain('Ada')
  })

  it('carries the threshold into describe_columns, not just into queries', async () => {
    loadSales()

    // `region` clears the sparse-identifier guard (3 distinct over 6 rows), so
    // what withholds it here can only be the threshold itself.
    const outcome = await call('describe_columns', {
      dataset: 'sales',
      columns: ['region'],
    })

    const profiles = payload(outcome).profiles as Array<Record<string, unknown>>
    expect(profiles[0]?.topCategories).toBeUndefined()
    expect(String(profiles[0]?.categoriesWithheld)).toContain(
      'no value occurs at least 5 times',
    )
    expect(JSON.stringify(outcome.payload)).not.toContain('North')
  })

  it('withholds a matched-row count small enough to identify someone', async () => {
    loadSales()

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      where: [{ column: 'rep', op: 'eq', value: 'Dev' }],
      aggregate: [{ op: 'max', column: 'amount' }],
    })

    // "exactly one record matches" identifies that record as surely as
    // returning it would, so the count is withheld with the rows.
    expect(payload(outcome).matchedRows).toBe('fewer than 5')
    expect(JSON.stringify(outcome.payload)).not.toContain('900')
  })

  it('closes the same oracle in set_report_filter, which used to hardcode 1', async () => {
    loadSales()

    const outcome = await call('set_report_filter', {
      dataset: 'sales',
      where: [{ column: 'rep', op: 'eq', value: 'Dev' }],
    })

    expect(payload(outcome).matchedRows).toBe('fewer than 5')
    // The filter is still applied: this is the person's report, and they can
    // see whatever they like in it. Only the agent's copy is withheld.
    expect(workspace.getFilter('sales')).toHaveLength(1)
  })

  it('cannot be lowered by a tool argument on any tool that takes a filter', async () => {
    loadSales()

    for (const [name, input] of [
      ['query_dataset', { dataset: 'sales', aggregate: [{ op: 'count' }], minGroupSize: 1 }],
      ['describe_columns', { dataset: 'sales', minGroupSize: 1 }],
      ['set_report_filter', { dataset: 'sales', where: [], minGroupSize: 1 }],
    ] as const) {
      const error = errorOf(await call(name, input))
      expect(error.code, name).toBe('invalid_input')
      expect(workspace.getState().minGroupSize).toBe(5)
    }
  })
})

describe('the counters must not republish what the threshold withheld', () => {
  // A red team recovered a named person's exact deal size in twenty calls using
  // nothing but these numbers. `matchedRows` was masked and then the identical
  // figure was handed back as `suppressed.rows`, which also answered "does this
  // person exist" (0 rows) and "how many reps are in the file" (suppressedGroups).

  it('does not hand back the matched count it just masked', async () => {
    loadSales()

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      where: [{ column: 'rep', op: 'eq', value: 'Ada' }],
      aggregate: [{ op: 'count' }],
    })

    const serialised = JSON.stringify(outcome.payload)
    expect(payload(outcome).matchedRows).toBe('fewer than 5')
    // Ada has two rows. That number must not appear anywhere in the payload.
    const suppressed = payload(outcome).suppressed as Record<string, unknown>
    expect(suppressed?.rows).toBeUndefined()
    expect(suppressed?.groups).toBeUndefined()
    expect(serialised).not.toMatch(/"rows":\s*2/)
  })

  it('cannot be used as an existence oracle', async () => {
    loadSales()

    const present = await call('query_dataset', {
      dataset: 'sales',
      where: [{ column: 'rep', op: 'eq', value: 'Ada' }],
      aggregate: [{ op: 'count' }],
    })
    const absent = await call('query_dataset', {
      dataset: 'sales',
      where: [{ column: 'rep', op: 'eq', value: 'Nobody At All' }],
      aggregate: [{ op: 'count' }],
    })

    // Someone in the file and someone who is not must be indistinguishable.
    expect(JSON.stringify(payload(present))).toBe(JSON.stringify(payload(absent)))
  })

  it('does not disclose how many groups the partition has', async () => {
    loadSales()

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['rep'],
      aggregate: [{ op: 'count' }],
      limit: 1,
    })

    // Six reps, all below the threshold. The cardinality of a protected column
    // is itself a disclosure, and `limit` must not be a way to ask for it.
    expect(JSON.stringify(outcome.payload)).not.toContain('4')
    const suppressed = payload(outcome).suppressed as Record<string, unknown>
    expect(suppressed?.groups).toBeUndefined()
    expect(payload(outcome).totalGroups).toBe(0)
  })

  it('still tells the agent what happened and what to do about it', async () => {
    loadSales()

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['rep'],
      aggregate: [{ op: 'count' }],
    })

    const suppressed = payload(outcome).suppressed as Record<string, unknown>
    expect(suppressed).toBeTruthy()
    expect(String(suppressed.reason)).toContain('5')
    expect(String(suppressed.reason)).toMatch(/widen/i)
  })
})

describe('Aggregates must never mean records, whatever the threshold says', () => {
  // Two controls disagreed. The trust dial promised "only aggregates, never a
  // record"; the group-size input said "1 turns it off". At 1 the promise was
  // false: grouping by every column returned twenty complete verbatim rows,
  // names included, and the ledger called it a read that released no rows.

  it('refuses to return a record even when the person turns the threshold off', async () => {
    loadSales()
    workspace.setMinGroupSize(1)

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['region', 'rep', 'amount'],
      aggregate: [{ op: 'count' }],
    })

    const serialised = JSON.stringify(outcome.payload)
    expect(payload(outcome).rows).toEqual([])
    expect(serialised).not.toContain('Ada')
    expect(serialised).not.toContain('900')
  })

  it('says so, rather than silently ignoring what the person set', async () => {
    loadSales()
    workspace.setMinGroupSize(1)

    const privacy = payload(await call('list_datasets')).privacy as Record<
      string,
      unknown
    >

    // The person's setting is reported honestly, and so is the floor that the
    // trust level imposes on top of it.
    expect(privacy.minGroupSize).toBe(2)
    expect(privacy.minGroupSizeRequested).toBe(1)
    expect(String(privacy.note)).toMatch(/aggregates/i)
  })

  it('lets Raw honour the threshold the person actually chose', async () => {
    loadSales()
    workspace.setTrustLevel('raw')
    workspace.setMinGroupSize(1)

    const outcome = await call('query_dataset', {
      dataset: 'sales',
      groupBy: ['rep'],
      aggregate: [{ op: 'count' }],
    })

    // At Raw the person has already accepted record-level access, gated by the
    // approval prompt. The floor is an Aggregates promise, not a global one.
    expect((payload(outcome).rows as unknown[]).length).toBeGreaterThan(0)
  })

  it('applies the floor to describe_columns too', async () => {
    loadSales()
    workspace.setMinGroupSize(1)

    const outcome = await call('describe_columns', {
      dataset: 'sales',
      columns: ['rep'],
    })

    const profiles = payload(outcome).profiles as Array<Record<string, unknown>>
    expect(JSON.stringify(profiles)).not.toContain('Dev')
  })
})

describe('every analytical tool honours the same policy', () => {
  // A red team found the threshold was applied by query_dataset and nowhere
  // else. describe_columns released min, max, mean, median and stdDev with no
  // guard at all, and detect_anomalies was never passed the threshold, so the
  // person's dial had literally no effect on it. Both returned exact values
  // from single records while the ledger recorded "0 raw rows".

  it('describe_columns withholds statistics computed from too few values', async () => {
    // Two people have a bonus; the other four rows are blank. min, max, mean
    // and median over two values are those two people's numbers.
    workspace.addDataset(
      buildDataset({
        name: 'bonuses.csv',
        text: [
          'name,bonus',
          'Ada,90000',
          'Bob,110000',
          'Cleo,',
          'Dev,',
          'Eve,',
          'Fay,',
        ].join('\n'),
      }),
    )

    const outcome = await call('describe_columns', {
      dataset: 'bonuses',
      columns: ['bonus'],
    })

    const profile = (payload(outcome).profiles as Record<string, unknown>[])[0]
    expect(profile?.min).toBeUndefined()
    expect(profile?.max).toBeUndefined()
    expect(profile?.mean).toBeUndefined()
    expect(profile?.medianValue).toBeUndefined()
    expect(String(profile?.statisticsWithheld)).toMatch(/fewer than/i)
    const serialised = JSON.stringify(outcome.payload)
    expect(serialised).not.toContain('90000')
    expect(serialised).not.toContain('110000')
  })

  it('describe_columns still profiles a column with enough values behind it', async () => {
    loadSales()

    const profile = (
      payload(await call('describe_columns', { dataset: 'sales', columns: ['amount'] }))
        .profiles as Record<string, unknown>[]
    )[0]

    // Six populated values, threshold five: this is a population, not a person.
    expect(typeof profile?.mean).toBe('number')
    expect(profile?.statisticsWithheld).toBeUndefined()
  })

  it('detect_anomalies does not name an outlier that is one record', async () => {
    workspace.addDataset(
      buildDataset({
        name: 'salaries.csv',
        text: [
          'name,salary',
          ...Array.from({ length: 12 }, (_, index) => `P${index},${50000 + index * 10}`),
          'Chief,4200000',
        ].join('\n'),
      }),
    )

    const outcome = await call('detect_anomalies', {
      dataset: 'salaries',
      kinds: ['outliers'],
    })

    // One person is the outlier. Their exact salary must not be the finding.
    expect(JSON.stringify(outcome.payload)).not.toContain('4200000')
  })

  it('the threshold reaches detect_anomalies at all', async () => {
    // Two outliers, so there is a value to name or withhold depending on where
    // the person has put the dial. Previously the dial did not reach this tool
    // and the numbers came out either way.
    workspace.addDataset(
      buildDataset({
        name: 'pay.csv',
        text: [
          'name,pay',
          ...Array.from({ length: 14 }, (_, index) => `P${index},${60000 + index * 5}`),
          'ExecA,3100000',
          'ExecB,3200000',
        ].join('\n'),
      }),
    )

    workspace.setMinGroupSize(2)
    const named = JSON.stringify(
      (await call('detect_anomalies', { dataset: 'pay', kinds: ['outliers'] })).payload,
    )
    workspace.setMinGroupSize(5)
    const withheld = JSON.stringify(
      (await call('detect_anomalies', { dataset: 'pay', kinds: ['outliers'] })).payload,
    )

    // Two records behind the finding: at a threshold of two it may be named.
    expect(named).toContain('3200000')
    // At five it may not, and the payload says why rather than going silent.
    expect(withheld).not.toContain('3200000')
    expect(withheld).toContain('boundsWithheld')
  })
})

describe('bounded arguments', () => {
  it('refuses an array long enough to lock up the tab', async () => {
    loadSales()

    const error = errorOf(
      await call('query_dataset', {
        dataset: 'sales',
        aggregate: [{ op: 'count' }],
        groupBy: Array.from({ length: 500 }, () => 'region'),
      }),
    )

    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('at most 50')
  })

  it('bounds every array an agent can pass, on every tool', () => {
    const unbounded: string[] = []

    for (const spec of ALL_TOOLS) {
      const properties = (spec.inputSchema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >
      for (const [property, schema] of Object.entries(properties)) {
        if (schema.type === 'array' && typeof schema.maxItems !== 'number') {
          unbounded.push(`${spec.name}.${property}`)
        }
      }
    }

    expect(unbounded).toEqual([])
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
    openThreshold()
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

describe('the ledger under pressure', () => {
  it('keeps the newest entries and says how many it is holding', async () => {
    loadSales()
    openThreshold()

    for (let call = 0; call < MAX_EGRESS_ENTRIES + 25; call += 1) {
      await runTool(tool('list_datasets'), workspace, {})
    }

    const { egress } = workspace.getState()
    expect(egress).toHaveLength(MAX_EGRESS_ENTRIES)
    // Newest first, so the cap drops the oldest rather than the newest.
    expect(egress[0]?.at).toBeGreaterThanOrEqual(
      egress[egress.length - 1]?.at as number,
    )
  })

  it('never lets an agent flush what it has already been given', async () => {
    // The ledger keeps a rolling window of the newest entries. The TOTALS must
    // not be computed from that window, or 200 cheap calls erase the record of
    // an approved raw release — the agent quietly deleting its own receipt.
    workspace.recordEgress({
      tool: 'sample_rows',
      risk: 'gated',
      summary: 'Human approved releasing 2 raw rows.',
      characters: 200,
      rowsReleased: 2,
      truncated: false,
    })

    expect(workspace.totalRowsReleased()).toBe(2)

    for (let call = 0; call < MAX_EGRESS_ENTRIES + 20; call += 1) {
      workspace.recordEgress({
        tool: 'list_datasets',
        risk: 'read',
        summary: 'noise',
        characters: 1,
        rowsReleased: 0,
        truncated: false,
      })
    }

    // The window has rolled; the account has not.
    expect(workspace.getState().egress).toHaveLength(MAX_EGRESS_ENTRIES)
    expect(workspace.totalRowsReleased()).toBe(2)
    expect(workspace.totalCharactersReleased()).toBe(200 + MAX_EGRESS_ENTRIES + 20)
    expect(workspace.totalToolCalls()).toBe(MAX_EGRESS_ENTRIES + 21)
  })

  it('keeps a lifetime account even though it shows only the newest entries', async () => {
    // The cap bounds memory. The totals are deliberately NOT computed from the
    // surviving entries: an account that shrinks when the window rolls is an
    // account an agent can flush.
    loadSales()
    openThreshold()

    for (let call = 0; call < MAX_EGRESS_ENTRIES + 5; call += 1) {
      await runTool(tool('list_datasets'), workspace, {})
    }

    const entries = workspace.getState().egress
    const inWindow = entries.reduce((total, entry) => total + entry.characters, 0)
    expect(entries).toHaveLength(MAX_EGRESS_ENTRIES)
    expect(workspace.totalToolCalls()).toBe(MAX_EGRESS_ENTRIES + 5)
    expect(workspace.totalCharactersReleased()).toBeGreaterThan(inWindow)
  })
})

describe('the approval gate under pressure', () => {
  it('times out to deny, so an unanswered prompt never releases anything', async () => {
    loadSales()
    workspace.setTrustLevel('raw')

    const decision = workspace.requestApproval(
      { tool: 'sample_rows', risk: 'gated', question: 'Release rows?' },
      { timeoutMs: 10 },
    )

    await expect(decision).resolves.toBe(false)
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('denies rather than queues a second request, so a prompt cannot be buried', async () => {
    const first = workspace.requestApproval({
      tool: 'sample_rows',
      risk: 'gated',
      question: 'First?',
    })
    const second = workspace.requestApproval({
      tool: 'clear_workspace',
      risk: 'gated',
      question: 'Second?',
    })

    await expect(second).resolves.toBe(false)
    // The person is still looking at the first question, not the second.
    expect(workspace.getState().pendingApproval?.question).toBe('First?')

    workspace.resolveApproval(false)
    await expect(first).resolves.toBe(false)
  })

  it('denies when the agent aborts the call it was waiting on', async () => {
    const controller = new AbortController()
    const decision = workspace.requestApproval(
      { tool: 'sample_rows', risk: 'gated', question: 'Release rows?' },
      { signal: controller.signal },
    )

    await waitFor(
      () => workspace.getState().pendingApproval !== null,
      'the approval prompt',
    )
    controller.abort()

    await expect(decision).resolves.toBe(false)
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('refuses immediately if the call was already aborted before it asked', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      workspace.requestApproval(
        { tool: 'sample_rows', risk: 'gated', question: 'Release rows?' },
        { signal: controller.signal },
      ),
    ).resolves.toBe(false)
    expect(workspace.getState().pendingApproval).toBeNull()
  })

  it('ignores an answer to a question nobody asked', () => {
    expect(() => workspace.resolveApproval(true)).not.toThrow()
    expect(workspace.getState().pendingApproval).toBeNull()
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

  /** Names of every tool that would be registered for the current state. */
  function offered(): string[] {
    const state = workspace.getState()
    return ALL_TOOLS
      .filter((spec) => spec.available(state))
      .map((spec) => spec.name)
      .sort()
  }

  it('withdraws every data-reading tool at "sealed"', () => {
    loadSales()
    workspace.setTrustLevel('sealed')

    expect(offered()).toEqual(['add_note', 'clear_workspace', 'list_datasets'])
  })

  it('offers aggregates but never the raw-row tool at "aggregates"', () => {
    loadSales()
    expect(workspace.getState().trustLevel).toBe('aggregates')

    expect(offered()).toEqual([
      'add_chart',
      'add_note',
      'clear_workspace',
      'describe_columns',
      'detect_anomalies',
      'list_datasets',
      'query_dataset',
      'set_report_filter',
    ])
  })

  it('adds only the human-gated raw-row tool at "raw"', () => {
    loadSales()
    workspace.setTrustLevel('raw')

    expect(offered()).toContain('sample_rows')
    expect(offered()).toHaveLength(9)
  })

  it('never offers a data tool without data, whatever the level', () => {
    workspace.setTrustLevel('raw')
    expect(offered()).toEqual(['add_note', 'list_datasets'])
  })

  it('refuses a call to a tool that has been withdrawn', async () => {
    loadSales()
    workspace.setTrustLevel('sealed')

    const error = errorOf(
      await call('query_dataset', { dataset: 'sales', aggregate: [{ op: 'count' }] }),
    )

    expect(error.code).toBe('tool_unavailable')
    // The refusal is still on the record.
    expect(workspace.getState().egress[0]?.tool).toBe('query_dataset')
    expect(workspace.getState().egress[0]?.summary).toMatch(/refused/)
  })

  it('keeps the withdrawal message inside the output budget', async () => {
    loadSales()
    workspace.setTrustLevel('sealed')
    const outcome = await call('describe_columns', { dataset: 'sales' })

    expect(outcome.ok).toBe(false)
    expect(outcome.characters).toBeLessThan(1500)
  })
})

describe('the trust dial', () => {
  it('starts at aggregates: useful, and reveals no record', () => {
    expect(workspace.getState().trustLevel).toBe('aggregates')
  })

  it('is ordered, so each level includes everything below it', () => {
    expect(trustAllows('sealed', 'sealed')).toBe(true)
    expect(trustAllows('sealed', 'aggregates')).toBe(false)
    expect(trustAllows('aggregates', 'aggregates')).toBe(true)
    expect(trustAllows('aggregates', 'raw')).toBe(false)
    expect(trustAllows('raw', 'sealed')).toBe(true)
    expect(trustAllows('raw', 'raw')).toBe(true)
  })

  it('ignores anything that is not a level, so a bad value cannot open the gate', () => {
    workspace.setTrustLevel('sealed')
    workspace.setTrustLevel('RAW' as never)
    workspace.setTrustLevel('' as never)
    workspace.setTrustLevel(undefined as never)

    expect(workspace.getState().trustLevel).toBe('sealed')
    expect(isTrustLevel('raw')).toBe(true)
    expect(isTrustLevel('Raw')).toBe(false)
    expect(isTrustLevel(2)).toBe(false)
  })

  it('cannot be set by a tool argument', async () => {
    loadSales()
    const error = errorOf(
      await call('query_dataset', {
        dataset: 'sales',
        aggregate: [{ op: 'count' }],
        trustLevel: 'raw',
      }),
    )

    expect(error.code).toBe('invalid_input')
    expect(workspace.getState().trustLevel).toBe('aggregates')
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
    workspace.setTrustLevel('raw')
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

    openThreshold()

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
