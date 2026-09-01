/**
 * Chrome's WebMCP security guidance publishes character budgets for tool
 * metadata; exceeding them makes agents behave badly. This file turns that
 * guidance into a test, so the budgets cannot quietly drift as descriptions get
 * edited.
 *
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */

import { describe, expect, it } from 'vitest'
import { ALL_TOOLS } from './index'
import { findUnsupportedKeywords, validateAgainstSchema } from './schema'

const MAX_NAME = 30
const MAX_DESCRIPTION = 500
const MAX_PARAM_DESCRIPTION = 150

describe('tool metadata budgets', () => {
  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s fits the published budgets',
    (_name, tool) => {
      expect(tool.name.length).toBeLessThanOrEqual(MAX_NAME)
      expect(tool.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION)
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.title.length).toBeGreaterThan(0)
    },
  )

  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s keeps every parameter description within budget',
    (_name, tool) => {
      for (const [property, description] of parameterDescriptions(tool.inputSchema)) {
        expect(
          description.length,
          `${tool.name}.${property} description is ${description.length} characters`,
        ).toBeLessThanOrEqual(MAX_PARAM_DESCRIPTION)
      }
    },
  )
})

describe('tool naming', () => {
  it('uses snake_case names an agent can type reliably', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('has no duplicate names', () => {
    const names = ALL_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('tool schemas', () => {
  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s uses only keywords the validator actually enforces',
    (_name, tool) => {
      // A keyword we do not implement would look like a constraint while
      // enforcing nothing, which is the worst way for a validator to fail.
      expect(findUnsupportedKeywords(tool.inputSchema)).toEqual([])
    },
  )

  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s rejects an argument object with an unknown property',
    (_name, tool) => {
      const problems = validateAgainstSchema(tool.inputSchema, {
        definitelyNotARealParameter: true,
      })
      expect(problems.some((p) => p.message.includes('unexpected property'))).toBe(
        true,
      )
    },
  )

  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s refuses unexpected properties at every level',
    (_name, tool) => {
      for (const schema of objectSchemas(tool.inputSchema)) {
        expect(schema.additionalProperties).toBe(false)
      }
    },
  )

  it.each(ALL_TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s takes an object at the top level',
    (_name, tool) => {
      expect(tool.inputSchema.type).toBe('object')
    },
  )

  it('describes every parameter it accepts', () => {
    for (const tool of ALL_TOOLS) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { description?: string }
      >
      for (const [name, schema] of Object.entries(properties)) {
        expect(
          schema.description,
          `${tool.name}.${name} has no description`,
        ).toBeTruthy()
      }
    }
  })
})

describe('tool annotations', () => {
  it('marks every read-only tool as such', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.risk === 'read') {
        expect(tool.annotations.readOnlyHint, tool.name).toBe(true)
      }
    }
  })

  it('never marks a writing tool read-only', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.risk === 'write') {
        expect(tool.annotations.readOnlyHint, tool.name).toBe(false)
      }
    }
  })

  it('flags tools that return content derived from the user file as untrusted', () => {
    const untrusted = ALL_TOOLS.filter(
      (tool) => tool.annotations.untrustedContentHint === true,
    ).map((tool) => tool.name)

    expect(untrusted).toContain('sample_rows')
    expect(untrusted).toContain('add_note')
  })
})

describe('the tool surface as a whole', () => {
  it('offers eleven tools across three risk classes', () => {
    expect(ALL_TOOLS).toHaveLength(11)

    const byRisk = {
      read: ALL_TOOLS.filter((tool) => tool.risk === 'read').length,
      write: ALL_TOOLS.filter((tool) => tool.risk === 'write').length,
      gated: ALL_TOOLS.filter((tool) => tool.risk === 'gated').length,
    }

    expect(byRisk).toEqual({ read: 4, write: 5, gated: 2 })
  })

  it('gates exactly the two operations that can lose data or reveal records', () => {
    const gated = ALL_TOOLS.filter((tool) => tool.risk === 'gated').map(
      (tool) => tool.name,
    )

    expect(gated.sort()).toEqual(['clear_workspace', 'sample_rows'])
  })

  it('mentions the gated alternative in the query tool description', () => {
    const query = ALL_TOOLS.find((tool) => tool.name === 'query_dataset')
    expect(query?.description).toMatch(/cannot return individual rows/i)
  })
})

// ---------------------------------------------------------------------------

type SchemaNode = Record<string, unknown>

function objectSchemas(schema: SchemaNode, found: SchemaNode[] = []): SchemaNode[] {
  if (schema.type === 'object') found.push(schema)

  const properties = (schema.properties ?? {}) as Record<string, SchemaNode>
  for (const child of Object.values(properties)) objectSchemas(child, found)

  const items = schema.items as SchemaNode | undefined
  if (items) objectSchemas(items, found)

  return found
}

function parameterDescriptions(
  schema: SchemaNode,
  prefix = '',
  found: [string, string][] = [],
): [string, string][] {
  const properties = (schema.properties ?? {}) as Record<string, SchemaNode>

  for (const [name, child] of Object.entries(properties)) {
    const path = prefix === '' ? name : `${prefix}.${name}`
    if (typeof child.description === 'string') found.push([path, child.description])
    parameterDescriptions(child, path, found)

    const items = child.items as SchemaNode | undefined
    if (items) parameterDescriptions(items, `${path}[]`, found)
  }

  return found
}
