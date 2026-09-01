import { describe, expect, it } from 'vitest'
import {
  POLYFILL_MARKER,
  describeEnvironment,
  detectWebMcpEnvironment,
} from './environment'
import type { ModelContext } from './types'

function fakeModelContext(): ModelContext {
  const target = new EventTarget() as ModelContext
  target.registerTool = async () => {}
  target.getTools = async () => []
  target.executeTool = async () => '{}'
  target.ontoolchange = null
  return target
}

const emptyWindow = () => ({}) as Window

describe('detectWebMcpEnvironment', () => {
  it('reports "none" when the browser has no modelContext', () => {
    const env = detectWebMcpEnvironment({} as Document, emptyWindow())

    expect(env.mode).toBe('none')
    expect(env.agentReachable).toBe(false)
    expect(env.modelContext).toBeUndefined()
  })

  it('reports "none" when modelContext exists but is not usable', () => {
    const doc = { modelContext: {} as ModelContext } as Document

    expect(detectWebMcpEnvironment(doc, emptyWindow()).mode).toBe('none')
  })

  it('reports "native" when the browser implements WebMCP', () => {
    const modelContext = fakeModelContext()
    const doc = { modelContext } as Document

    const env = detectWebMcpEnvironment(doc, emptyWindow())

    expect(env.mode).toBe('native')
    expect(env.agentReachable).toBe(true)
    expect(env.modelContext).toBe(modelContext)
  })

  it('reports "polyfill" and marks tools unreachable when we installed it', () => {
    const doc = { modelContext: fakeModelContext() } as Document
    const win = { [POLYFILL_MARKER]: true } as Window

    const env = detectWebMcpEnvironment(doc, win)

    expect(env.mode).toBe('polyfill')
    expect(env.agentReachable).toBe(false)
  })
})

describe('describeEnvironment', () => {
  it('produces a distinct message for every mode', () => {
    const messages = (['native', 'polyfill', 'none'] as const).map((mode) =>
      describeEnvironment({ mode, agentReachable: false, modelContext: undefined }),
    )

    expect(new Set(messages).size).toBe(3)
    for (const message of messages) expect(message.length).toBeGreaterThan(0)
  })
})
