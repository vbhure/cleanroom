/**
 * Input validation.
 *
 * The schema we advertise to the agent is the schema we enforce — one object,
 * used for both, so a tool cannot claim to accept something it rejects.
 * Failures come back as structured, actionable errors rather than exceptions,
 * because the caller is usually a model that can fix its own mistake if told
 * precisely what was wrong.
 *
 * Prototype-polluting keys are rejected before the schema is consulted at all.
 * Tool arguments are attacker-influenced data: they arrive from an agent that
 * has been reading a page, and that page may not be ours.
 */

import type { JsonSchema, Problem } from './schema'
import { validateAgainstSchema } from './schema'
import type { ToolFailure } from './types'
import { fail } from './types'

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

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
      failure: fail('invalid_input', 'Tool arguments must be a JSON object.', {
        received: input === null ? 'null' : typeof input,
      }),
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

  const problems = validateAgainstSchema(schema, input)
  if (problems.length === 0) {
    return { ok: true, value: input as Record<string, unknown> }
  }

  return {
    ok: false,
    failure: fail('invalid_input', describeProblems(problems), {
      problems: problems.slice(0, 8).map(describeProblem),
    }),
  }
}

function describeProblem(problem: Problem): string {
  return `${problem.path} ${problem.message}.`
}

function describeProblems(problems: readonly Problem[]): string {
  const first = describeProblem(problems[0] as Problem)

  return problems.length === 1
    ? first
    : `${first} (and ${problems.length - 1} other problem${problems.length === 2 ? '' : 's'})`
}
