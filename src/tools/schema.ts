/**
 * A small JSON Schema validator.
 *
 * Written rather than installed for a specific reason: Ajv compiles schemas
 * into JavaScript with `new Function`, and Cleanroom serves itself under
 * `script-src 'self'` with no `unsafe-eval`. The containment guarantee is the
 * product, so the validator had to give way, not the policy.
 *
 * It covers exactly the subset our tool schemas use — types, properties,
 * required, additionalProperties, items, enum, and the length, size and range
 * bounds — and nothing else. Anything a schema asks for that is not listed here
 * is not silently ignored: `assertSupportedSchema` fails loudly in tests, so an
 * unsupported keyword cannot quietly stop being enforced.
 */

export type JsonSchema = Record<string, unknown>

const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'description',
  'title',
])

export interface Problem {
  /** Human-readable location, e.g. `input`, `aggregate[0].op`. */
  path: string
  message: string
}

export function validateAgainstSchema(
  schema: JsonSchema,
  value: unknown,
): Problem[] {
  const problems: Problem[] = []
  check(schema, value, 'input', problems)
  return problems
}

function check(
  schema: JsonSchema,
  value: unknown,
  path: string,
  problems: Problem[],
): void {
  // A schema with no `type` (our filter `value` field) accepts anything, but
  // still honours `enum` if one is present.
  const type = schema.type as string | undefined

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((candidate) => Object.is(candidate, value))) {
      problems.push({
        path,
        message: `must be one of: ${schema.enum.map((item) => String(item)).join(', ')}`,
      })
      return
    }
  }

  if (type === undefined) return

  if (!matchesType(type, value)) {
    problems.push({ path, message: `must be ${article(type)}` })
    return
  }

  switch (type) {
    case 'object':
      checkObject(schema, value as Record<string, unknown>, path, problems)
      break
    case 'array':
      checkArray(schema, value as unknown[], path, problems)
      break
    case 'string':
      checkString(schema, value as string, path, problems)
      break
    case 'number':
    case 'integer':
      checkNumber(schema, value as number, path, problems)
      break
    default:
      break
  }
}

function checkObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  problems: Problem[],
): void {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const required = (schema.required ?? []) as string[]

  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      problems.push({ path, message: `is missing the required property "${name}"` })
    }
  }

  if (schema.additionalProperties === false) {
    for (const name of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, name)) {
        problems.push({ path, message: `has an unexpected property "${name}"` })
      }
    }
  }

  for (const [name, child] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) continue
    check(child, value[name], path === 'input' ? name : `${path}.${name}`, problems)
  }
}

function checkArray(
  schema: JsonSchema,
  value: unknown[],
  path: string,
  problems: Problem[],
): void {
  const minItems = schema.minItems as number | undefined
  const maxItems = schema.maxItems as number | undefined

  if (typeof minItems === 'number' && value.length < minItems) {
    problems.push({
      path,
      message: `must have at least ${minItems} item${minItems === 1 ? '' : 's'}`,
    })
  }
  if (typeof maxItems === 'number' && value.length > maxItems) {
    problems.push({
      path,
      message: `must have at most ${maxItems} item${maxItems === 1 ? '' : 's'}`,
    })
  }

  const items = schema.items as JsonSchema | undefined
  if (!items) return

  value.forEach((item, index) => {
    check(items, item, `${path}[${index}]`, problems)
  })
}

function checkString(
  schema: JsonSchema,
  value: string,
  path: string,
  problems: Problem[],
): void {
  const minLength = schema.minLength as number | undefined
  const maxLength = schema.maxLength as number | undefined

  if (typeof minLength === 'number' && value.length < minLength) {
    problems.push({
      path,
      message: `must be at least ${minLength} character${minLength === 1 ? '' : 's'}`,
    })
  }
  if (typeof maxLength === 'number' && value.length > maxLength) {
    problems.push({
      path,
      message: `must be at most ${maxLength} character${maxLength === 1 ? '' : 's'}`,
    })
  }
}

function checkNumber(
  schema: JsonSchema,
  value: number,
  path: string,
  problems: Problem[],
): void {
  const minimum = schema.minimum as number | undefined
  const maximum = schema.maximum as number | undefined

  if (typeof minimum === 'number' && value < minimum) {
    problems.push({ path, message: `must be at least ${minimum}` })
  }
  if (typeof maximum === 'number' && value > maximum) {
    problems.push({ path, message: `must be at most ${maximum}` })
  }
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'null':
      return value === null
    default:
      return true
  }
}

function article(type: string): string {
  switch (type) {
    case 'object':
      return 'an object'
    case 'array':
      return 'an array'
    case 'integer':
      return 'an integer'
    default:
      return `a ${type}`
  }
}

/**
 * Fails if a schema uses a keyword this validator does not implement.
 *
 * Called from the test suite over every tool schema. Without it, adding an
 * unsupported keyword would look like it was constraining input while doing
 * nothing at all — the worst possible failure mode for a validator.
 */
export function findUnsupportedKeywords(
  schema: JsonSchema,
  path = 'root',
  found: string[] = [],
): string[] {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) found.push(`${path}.${keyword}`)
  }

  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  for (const [name, child] of Object.entries(properties)) {
    findUnsupportedKeywords(child, `${path}.${name}`, found)
  }

  const items = schema.items as JsonSchema | undefined
  if (items) findUnsupportedKeywords(items, `${path}[]`, found)

  return found
}
