/**
 * Input validation.
 *
 * The schema we advertise to the agent is the schema Ajv enforces — there is
 * one object, used for both, so a tool cannot claim to accept something it
 * rejects. Validation failures come back as structured, actionable errors
 * rather than exceptions, because the caller is usually a model that can fix
 * its own mistake if told precisely what was wrong.
 *
 * Prototype-polluting keys are rejected before Ajv ever sees the input. A JSON
 * payload is attacker-influenced data — it arrives from a page an agent was
 * reading, and that page may not be ours.
 */

import Ajv from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { JsonSchema, ToolFailure } from './types'
import { fail } from './types'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const ajv = new Ajv({
  allErrors: true,
  // Our schemas are authored by hand and kept simple; strict mode's
  // metaschema opinions add nothing here.
  strict: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
})

const compiled = new WeakMap<JsonSchema, ValidateFunction>()

function compile(schema: JsonSchema): ValidateFunction {
  const existing = compiled.get(schema)
  if (existing) return existing

  const validator = ajv.compile(schema)
  compiled.set(schema, validator)
  return validator
}

/** Depth-limited scan for keys that would corrupt Object.prototype. */
export function findForbiddenKey(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === null || typeof value !== 'object') return undefined

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item, depth + 1)
      if (found) return found
    }
    return undefined
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_KEYS.has(key)) return key
    const found = findForbiddenKey(
      (value as Record<string, unknown>)[key],
      depth + 1,
    )
    if (found) return found
  }

  return undefined
}

export type ValidationOutcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; failure: ToolFailure }

export function validateInput(
  schema: JsonSchema,
  input: unknown,
): ValidationOutcome {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      failure: fail(
        'invalid_input',
        'Tool arguments must be a JSON object.',
        { received: input === null ? 'null' : typeof input },
      ),
    }
  }

  const forbidden = findForbiddenKey(input)
  if (forbidden) {
    return {
      ok: false,
      failure: fail(
        'forbidden_key',
        `The key "${forbidden}" is not allowed in tool arguments.`,
      ),
    }
  }

  const validator = compile(schema)
  if (validator(input)) {
    return { ok: true, value: input as Record<string, unknown> }
  }

  return {
    ok: false,
    failure: fail(
      'invalid_input',
      describeErrors(validator.errors ?? []),
      { problems: (validator.errors ?? []).slice(0, 8).map(describeError) },
    ),
  }
}

function describeError(error: ErrorObject): string {
  const path = error.instancePath === '' ? 'input' : error.instancePath.slice(1)

  if (error.keyword === 'additionalProperties') {
    const extra = (error.params as { additionalProperty?: string })
      .additionalProperty
    return `${path} has an unexpected property "${extra}".`
  }
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: string }).missingProperty
    return `${path} is missing the required property "${missing}".`
  }
  if (error.keyword === 'enum') {
    const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues
    return `${path} must be one of: ${(allowed ?? []).join(', ')}.`
  }

  return `${path} ${error.message ?? 'is invalid'}.`
}

function describeErrors(errors: readonly ErrorObject[]): string {
  if (errors.length === 0) return 'The arguments did not match the tool schema.'
  const first = describeError(errors[0] as ErrorObject)
  return errors.length === 1
    ? first
    : `${first} (and ${errors.length - 1} other problem${errors.length === 2 ? '' : 's'})`
}
