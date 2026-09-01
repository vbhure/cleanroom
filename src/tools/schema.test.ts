import { describe, expect, it } from 'vitest'
import { findUnsupportedKeywords, validateAgainstSchema } from './schema'
import type { JsonSchema } from './schema'

const messages = (schema: JsonSchema, value: unknown) =>
  validateAgainstSchema(schema, value).map(
    (problem) => `${problem.path} ${problem.message}`,
  )

const OBJECT: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 5 },
    count: { type: 'integer', minimum: 1, maximum: 10 },
    ratio: { type: 'number' },
    flag: { type: 'boolean' },
    mode: { type: 'string', enum: ['fast', 'slow'] },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    nested: {
      type: 'object',
      properties: { inner: { type: 'string' } },
      required: ['inner'],
      additionalProperties: false,
    },
    anything: {},
  },
  required: ['name'],
  additionalProperties: false,
}

describe('types', () => {
  it('accepts a valid object', () => {
    expect(
      messages(OBJECT, {
        name: 'abc',
        count: 5,
        ratio: 1.5,
        flag: true,
        mode: 'fast',
        tags: ['a'],
        nested: { inner: 'x' },
        anything: { whatever: [1, 2] },
      }),
    ).toEqual([])
  })

  it.each([
    ['string', { name: 1 }, 'name must be a string'],
    ['integer', { name: 'ab', count: 1.5 }, 'count must be an integer'],
    ['number', { name: 'ab', ratio: 'x' }, 'ratio must be a number'],
    ['boolean', { name: 'ab', flag: 'yes' }, 'flag must be a boolean'],
    ['array', { name: 'ab', tags: 'a' }, 'tags must be an array'],
    ['object', { name: 'ab', nested: [] }, 'nested must be an object'],
  ])('rejects the wrong %s type', (_label, value, expected) => {
    expect(messages(OBJECT, value)).toContain(expected)
  })

  it('rejects a non-finite number', () => {
    expect(messages(OBJECT, { name: 'ab', ratio: Number.NaN })).toContain(
      'ratio must be a number',
    )
  })

  it('accepts any value where the schema states no type', () => {
    expect(messages(OBJECT, { name: 'ab', anything: null })).toEqual([])
    expect(messages(OBJECT, { name: 'ab', anything: 42 })).toEqual([])
  })
})

describe('required and additional properties', () => {
  it('reports a missing required property', () => {
    expect(messages(OBJECT, {})).toContain(
      'input is missing the required property "name"',
    )
  })

  it('reports an unexpected property', () => {
    expect(messages(OBJECT, { name: 'ab', sneaky: 1 })).toContain(
      'input has an unexpected property "sneaky"',
    )
  })

  it('reports problems inside a nested object with a readable path', () => {
    expect(messages(OBJECT, { name: 'ab', nested: {} })).toContain(
      'nested is missing the required property "inner"',
    )
    expect(messages(OBJECT, { name: 'ab', nested: { inner: 'x', extra: 1 } })).toContain(
      'nested has an unexpected property "extra"',
    )
  })

  it('allows extra properties when additionalProperties is not false', () => {
    const permissive: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
    }
    expect(messages(permissive, { a: 'x', b: 2 })).toEqual([])
  })

  it('does not treat an inherited property as present', () => {
    const hostile = Object.create({ name: 'inherited' }) as Record<string, unknown>
    expect(messages(OBJECT, hostile)).toContain(
      'input is missing the required property "name"',
    )
  })
})

describe('bounds', () => {
  it('enforces string length', () => {
    expect(messages(OBJECT, { name: 'a' })).toContain(
      'name must be at least 2 characters',
    )
    expect(messages(OBJECT, { name: 'abcdef' })).toContain(
      'name must be at most 5 characters',
    )
  })

  it('enforces numeric range', () => {
    expect(messages(OBJECT, { name: 'ab', count: 0 })).toContain(
      'count must be at least 1',
    )
    expect(messages(OBJECT, { name: 'ab', count: 11 })).toContain(
      'count must be at most 10',
    )
  })

  it('enforces array size', () => {
    expect(messages(OBJECT, { name: 'ab', tags: [] })).toContain(
      'tags must have at least 1 item',
    )
    expect(messages(OBJECT, { name: 'ab', tags: ['a', 'b', 'c', 'd'] })).toContain(
      'tags must have at most 3 items',
    )
  })

  it('validates every array item with an indexed path', () => {
    expect(messages(OBJECT, { name: 'ab', tags: ['a', 2] })).toContain(
      'tags[1] must be a string',
    )
  })
})

describe('enum', () => {
  it('rejects a value outside the enum and lists the options', () => {
    expect(messages(OBJECT, { name: 'ab', mode: 'medium' })).toContain(
      'mode must be one of: fast, slow',
    )
  })

  it('supports a single-value enum used as a confirmation flag', () => {
    const confirmSchema: JsonSchema = {
      type: 'object',
      properties: { confirm: { type: 'boolean', enum: [true] } },
      required: ['confirm'],
      additionalProperties: false,
    }

    expect(messages(confirmSchema, { confirm: true })).toEqual([])
    expect(messages(confirmSchema, { confirm: false })).toContain(
      'confirm must be one of: true',
    )
  })
})

describe('findUnsupportedKeywords', () => {
  it('finds nothing in a supported schema', () => {
    expect(findUnsupportedKeywords(OBJECT)).toEqual([])
  })

  it('reports a keyword the validator does not implement', () => {
    const unsupported: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string', pattern: '^x' } },
      additionalProperties: false,
    }

    expect(findUnsupportedKeywords(unsupported)).toEqual(['root.a.pattern'])
  })

  it('looks inside array items', () => {
    const unsupported: JsonSchema = {
      type: 'array',
      items: { type: 'object', properties: {}, oneOf: [] },
    }

    expect(findUnsupportedKeywords(unsupported)).toContain('root[].oneOf')
  })
})

describe('the reason this validator exists', () => {
  it('never evaluates a string as code', () => {
    // Ajv compiles schemas with `new Function`, which the app's
    // `script-src 'self'` policy blocks. This validator interprets instead.
    const source = validateAgainstSchema.toString()
    expect(source).not.toContain('new Function')
    expect(source).not.toContain('eval(')
  })
})
