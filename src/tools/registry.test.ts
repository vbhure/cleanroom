/**
 * WebMCP integration tests.
 *
 * These drive the tools the way an agent does — `getTools()` to discover,
 * `executeTool()` to invoke — through a real implementation of the interface,
 * rather than calling our handlers directly. That is the behaviour a judge will
 * exercise, so it is the behaviour under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDataset } from '../data/dataset'
import { WorkspaceStore } from '../state/workspace'
import { createLocalModelContext } from '../webmcp/fallback'
import type { ModelContext, RegisteredTool } from '../webmcp/types'
import { ToolRegistrar } from './registry'

let workspace: WorkspaceStore
let modelContext: ModelContext
let registrar: ToolRegistrar

beforeEach(async () => {
  workspace = new WorkspaceStore()
  modelContext = createLocalModelContext()
  registrar = new ToolRegistrar({ modelContext, workspace })
  await registrar.start()
})

afterEach(async () => {
  await registrar.stop()
})

function loadSales() {
  workspace.addDataset(
    buildDataset({
      name: 'sales.csv',
      text: 'region,amount\nNorth,100\nNorth,250\nSouth,400\nEast,900',
    }),
  )
}

async function toolNames(): Promise<string[]> {
  const tools = await modelContext.getTools()
  return tools.map((tool) => tool.name).sort()
}

async function findRegistered(name: string): Promise<RegisteredTool> {
  const tools = await modelContext.getTools()
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`tool ${name} is not registered`)
  return tool
}

/** Calls a tool the way an agent does, and parses the stringified result. */
async function execute(name: string, input: Record<string, unknown> = {}) {
  const tool = await findRegistered(name)
  const raw = await modelContext.executeTool(tool, input)
  expect(typeof raw).toBe('string')
  return JSON.parse(raw) as Record<string, unknown>
}

// ---------------------------------------------------------------------------

describe('tool discovery', () => {
  it('registers only the tools that can work on an empty workspace', async () => {
    expect(await toolNames()).toEqual(['add_note', 'list_datasets'])
  })

  it('publishes the full metadata an agent needs to choose a tool', async () => {
    const tool = await findRegistered('list_datasets')

    expect(tool.description.length).toBeGreaterThan(40)
    expect(tool.title).toBeTruthy()
    expect(tool.annotations?.readOnlyHint).toBe(true)
    expect((tool.inputSchema as { type?: string }).type).toBe('object')
  })

  it('exposes tools to the same origin only', async () => {
    // No exposedTo was configured, so nothing is shared cross-origin.
    const tool = await findRegistered('list_datasets')
    expect(tool.origin).toBe(globalThis.location.origin)
  })
})

describe('toolchange — the tool surface follows the app state', () => {
  it('adds the data tools the moment a dataset is loaded', async () => {
    expect(await toolNames()).not.toContain('query_dataset')

    loadSales()
    await settle()

    const names = await toolNames()
    expect(names).toContain('query_dataset')
    expect(names).toContain('describe_columns')
    expect(names).toContain('detect_anomalies')
    expect(names).toContain('add_chart')
    expect(names).toContain('clear_workspace')
  })

  it('withdraws them again when the dataset is removed', async () => {
    loadSales()
    await settle()
    expect(await toolNames()).toContain('query_dataset')

    workspace.removeDataset('sales')
    await settle()

    expect(await toolNames()).not.toContain('query_dataset')
  })

  it('offers block-editing tools only once the report has blocks', async () => {
    expect(await toolNames()).not.toContain('remove_report_block')

    await execute('add_note', { markdown: 'A first note.' })
    await settle()

    expect(await toolNames()).toContain('remove_report_block')
    expect(await toolNames()).toContain('update_report_block')
  })

  it('fires a toolchange event that an agent can listen for', async () => {
    let fired = 0
    modelContext.addEventListener('toolchange', () => {
      fired += 1
    })

    loadSales()
    await settle()

    expect(fired).toBeGreaterThan(0)
  })

  it('never registers the same tool twice through repeated state changes', async () => {
    for (let i = 0; i < 5; i += 1) {
      workspace.setMinGroupSize(i + 1)
      await settle()
    }

    const names = (await modelContext.getTools()).map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the trust dial changes what the agent is offered', () => {
  it('starts at aggregates: the raw-row tool is not registered at all', async () => {
    loadSales()
    await settle()

    const names = await toolNames()
    expect(names).toHaveLength(8)
    expect(names).toContain('query_dataset')
    expect(names).not.toContain('sample_rows')
  })

  it('registers sample_rows only when the person turns the dial to raw', async () => {
    loadSales()
    await settle()

    workspace.setTrustLevel('raw')
    await settle()

    const names = await toolNames()
    expect(names).toHaveLength(9)
    expect(names).toContain('sample_rows')
  })

  it('withdraws every data-reading tool at sealed, leaving the safe three', async () => {
    loadSales()
    await settle()

    workspace.setTrustLevel('sealed')
    await settle()

    expect(await toolNames()).toEqual(['add_note', 'clear_workspace', 'list_datasets'])
  })

  it('withdraws sample_rows again the moment the dial comes down', async () => {
    loadSales()
    workspace.setTrustLevel('raw')
    await settle()
    expect(await toolNames()).toContain('sample_rows')

    workspace.setTrustLevel('aggregates')
    await settle()

    expect(await toolNames()).not.toContain('sample_rows')
    // A stale handle from before the change is dead, not merely refusing.
    const stale = { name: 'sample_rows' } as RegisteredTool
    await expect(modelContext.executeTool(stale, {})).rejects.toThrow(
      /No tool named "sample_rows"/,
    )
  })

  it('announces each move of the dial with a toolchange event', async () => {
    loadSales()
    await settle()

    let fired = 0
    modelContext.addEventListener('toolchange', () => {
      fired += 1
    })

    workspace.setTrustLevel('sealed')
    await settle()
    const afterSealed = fired
    expect(afterSealed).toBeGreaterThan(0)

    workspace.setTrustLevel('raw')
    await settle()
    expect(fired).toBeGreaterThan(afterSealed)
  })

  it('does not fire toolchange for a move that changes nothing', async () => {
    loadSales()
    await settle()

    let fired = 0
    modelContext.addEventListener('toolchange', () => {
      fired += 1
    })

    workspace.setTrustLevel('aggregates')
    await settle()

    expect(fired).toBe(0)
  })

  it('aborts a raw-row request that is waiting on the person when the dial comes down', async () => {
    loadSales()
    workspace.setTrustLevel('raw')
    await settle()

    const tool = await findRegistered('sample_rows')
    const pending = modelContext.executeTool(tool, {
      dataset: 'sales',
      reason: 'checking a record while the dial is up',
    })
    for (let i = 0; i < 20 && !workspace.getState().pendingApproval; i += 1) {
      await settle()
    }
    expect(workspace.getState().pendingApproval).not.toBeNull()

    workspace.setTrustLevel('aggregates')
    await settle()

    // The prompt is gone with the tool, and the agent gets a refusal.
    expect(workspace.getState().pendingApproval).toBeNull()
    const result = JSON.parse(await pending) as { error?: { code?: string } }
    expect(result.error?.code).toBe('approval_denied')
    expect(workspace.totalRowsReleased()).toBe(0)
  })

  it('reports the level to an agent that asks, so it can plan', async () => {
    loadSales()
    workspace.setTrustLevel('sealed')
    await settle()

    const result = await execute('list_datasets')
    const privacy = result.privacy as Record<string, unknown>
    expect(privacy.trustLevel).toBe('sealed')
    expect(privacy.rawRowAccess).toBe('disabled')
  })
})

describe('tool execution through the WebMCP interface', () => {
  it('returns a JSON string an agent can parse', async () => {
    loadSales()
    // Six rows in groups of one to three: the shipped threshold would suppress
    // every one of them, correctly. This test is about the JSON round trip, and
    // single-row groups are only answerable at the raw level, where the person
    // has accepted record access.
    workspace.setTrustLevel('raw')
    workspace.setMinGroupSize(1)
    await settle()

    const result = await execute('query_dataset', {
      dataset: 'sales',
      groupBy: ['region'],
      aggregate: [{ op: 'sum', column: 'amount' }],
      orderBy: [{ column: 'sum_of_amount', direction: 'desc' }],
    })

    expect(result.rows).toEqual([
      ['East', 900],
      ['South', 400],
      ['North', 350],
    ])
  })

  it('returns a structured error rather than rejecting', async () => {
    loadSales()
    await settle()

    const result = await execute('query_dataset', {
      dataset: 'sales',
      aggregate: [{ op: 'sum', column: 'region' }],
    })

    expect((result.error as { code?: string }).code).toBe('type_mismatch')
  })

  it('validates arguments at the boundary', async () => {
    loadSales()
    await settle()

    const result = await execute('describe_columns', { wrong: 'shape' })
    expect((result.error as { code?: string }).code).toBe('invalid_input')
  })

  it('writes through to the shared report, where the human sees it', async () => {
    loadSales()
    await settle()

    await execute('add_chart', {
      dataset: 'sales',
      title: 'Revenue by region',
      type: 'bar',
      groupBy: 'region',
      aggregate: { op: 'sum', column: 'amount' },
    })

    const blocks = workspace.getState().blocks
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.author).toBe('agent')
  })

  it('records every agent call in the egress ledger', async () => {
    loadSales()
    await settle()

    await execute('list_datasets')
    await execute('describe_columns', { dataset: 'sales' })

    expect(workspace.getState().egress).toHaveLength(2)
  })

  it('refuses to execute a tool that is not currently registered', async () => {
    const phantom = { name: 'query_dataset' } as RegisteredTool

    // query_dataset is unavailable with no dataset loaded.
    await expect(modelContext.executeTool(phantom, {})).rejects.toThrow(
      /No tool named "query_dataset"/,
    )
  })
})

describe('registrar lifecycle', () => {
  it('unregisters everything on stop', async () => {
    loadSales()
    await settle()
    expect((await toolNames()).length).toBeGreaterThan(2)

    await registrar.stop()
    expect(await toolNames()).toEqual([])
  })

  it('is safe to start twice', async () => {
    await registrar.start()
    const names = await toolNames()
    expect(new Set(names).size).toBe(names.length)
  })

  it('survives a teardown-then-setup, the way StrictMode mounts an effect', async () => {
    // React mounts every effect twice in development. Two registrars therefore
    // overlap on one shared registry whose names are unique, and the second
    // one's registerTool was rejected for a name the first had not finished
    // releasing: `npm run dev` came up with an error banner and add_note
    // missing. Start and stop are serialised across instances now.
    const failures: string[] = []
    // A context of its own, so the suite's own registrar is not a third party
    // to the race being tested.
    const context = createLocalModelContext()
    const first = new ToolRegistrar({
      modelContext: context,
      workspace,
      onError: (name) => failures.push(name),
    })
    const second = new ToolRegistrar({
      modelContext: context,
      workspace,
      onError: (name) => failures.push(name),
    })

    // Deliberately not awaited in order: this is the interleaving StrictMode
    // produces, with the replacement starting before the original has gone.
    const cycle = Promise.all([first.start(), first.stop(), second.start()])
    await cycle
    await settle()

    expect(failures).toEqual([])
    const names = (await context.getTools()).map((tool) => tool.name).sort()
    expect(names).toEqual(['add_note', 'list_datasets'])

    await second.stop()
  })

  it('does not let a replaced registration tear down the one that replaced it', async () => {
    // The abort listener used to delete by name, so a late abort from a
    // registration that had already been replaced unregistered the live tool
    // standing in its place.
    const context = createLocalModelContext()
    const first = new AbortController()

    await context.registerTool(
      { name: 'ghost', description: 'first', execute: () => 'first' },
      { signal: first.signal },
    )
    first.abort()

    await context.registerTool(
      { name: 'ghost', description: 'second', execute: () => 'second' },
      { signal: new AbortController().signal },
    )
    first.abort()

    const tools = await context.getTools()
    expect(tools.map((tool) => tool.name)).toEqual(['ghost'])
    expect(tools[0]?.description).toBe('second')
  })

  it('reports registration failures instead of failing silently', async () => {
    const failures: string[] = []
    const hostile = createLocalModelContext()
    hostile.registerTool = () => Promise.reject(new Error('registration refused'))

    const failing = new ToolRegistrar({
      modelContext: hostile,
      workspace,
      onError: (name) => failures.push(name),
    })

    await failing.start()
    await settle()

    expect(failures.length).toBeGreaterThan(0)
    await failing.stop()
  })
})

describe('the local WebMCP implementation itself', () => {
  it('rejects a duplicate tool name', async () => {
    const context = createLocalModelContext()
    const tool = {
      name: 'demo',
      description: 'A demonstration tool used only in tests.',
      execute: () => ({ ok: true }),
    }

    await context.registerTool(tool)
    await expect(context.registerTool(tool)).rejects.toThrow(/already registered/i)
  })

  it('rejects empty names and descriptions', async () => {
    const context = createLocalModelContext()

    await expect(
      context.registerTool({ name: '', description: 'x', execute: () => null }),
    ).rejects.toThrow(TypeError)

    await expect(
      context.registerTool({ name: 'x', description: '', execute: () => null }),
    ).rejects.toThrow(TypeError)
  })

  it('unregisters when the registration signal aborts', async () => {
    const context = createLocalModelContext()
    const controller = new AbortController()

    await context.registerTool(
      {
        name: 'temporary',
        description: 'A tool that exists only until its signal aborts.',
        execute: () => ({ ok: true }),
      },
      { signal: controller.signal },
    )

    expect(await context.getTools()).toHaveLength(1)
    controller.abort()
    expect(await context.getTools()).toHaveLength(0)
  })

  it('passes an abort signal through to the tool', async () => {
    const context = createLocalModelContext()
    let seenAborted: boolean | undefined

    await context.registerTool({
      name: 'watcher',
      description: 'Reports whether its execution signal was already aborted.',
      execute: (_input, { signal }) => {
        seenAborted = signal.aborted
        return { seenAborted }
      },
    })

    const controller = new AbortController()
    controller.abort()
    const tool = (await context.getTools())[0] as RegisteredTool
    await context.executeTool(tool, {}, { signal: controller.signal })

    expect(seenAborted).toBe(true)
  })
})

/** Lets the registrar's asynchronous sync settle before asserting. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('annotation defaults', () => {
  it('publishes both annotation hints even when a tool sets neither', async () => {
    const context = createLocalModelContext()

    await context.registerTool({
      name: 'bare',
      description: 'A tool that declares no annotations at all.',
      execute: () => ({ ok: true }),
    })

    // The ToolAnnotations dictionary defaults both members to false, so an
    // agent must never have to distinguish "absent" from "false".
    const [tool] = await context.getTools()
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false,
    })
  })

  it('preserves hints a tool does set', async () => {
    const context = createLocalModelContext()

    await context.registerTool({
      name: 'flagged',
      description: 'A tool that declares both annotation hints explicitly.',
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({ ok: true }),
    })

    const [tool] = await context.getTools()
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    })
  })
})
