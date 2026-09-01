/**
 * Output budgeting.
 *
 * Chrome's WebMCP guidance puts a 1.5K character ceiling on a single tool
 * result, and exceeding it makes agents behave badly. In Cleanroom the ceiling
 * does double duty: it is also the rate limiter on how fast a dataset could be
 * drained through repeated calls, and every character spent is recorded in the
 * egress ledger.
 *
 * Trimming is honest rather than silent. When rows are dropped the payload says
 * how many were dropped and why, so the agent knows it is looking at a partial
 * answer and can narrow its query instead of assuming it has everything.
 */

/** Per Chrome's WebMCP security guidance. */
export const MAX_TOOL_OUTPUT_CHARACTERS = 1500

/** Fields that may be shortened, in the order we are willing to shorten them. */
const TRIMMABLE_KEYS = ['rows', 'profiles', 'anomalies', 'datasets'] as const

export interface CappedOutput {
  value: unknown
  characters: number
  truncated: boolean
}

function serialise(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return '"[unserialisable]"'
  }
}

/**
 * Shrinks a payload to fit the character budget, preferring to drop list items
 * over mangling the structure.
 */
export function capOutput(
  payload: unknown,
  limit = MAX_TOOL_OUTPUT_CHARACTERS,
): CappedOutput {
  const initial = serialise(payload)
  if (initial.length <= limit) {
    return { value: payload, characters: initial.length, truncated: false }
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = { ...(payload as Record<string, unknown>) }

    for (const key of TRIMMABLE_KEYS) {
      const list = record[key]
      if (!Array.isArray(list) || list.length === 0) continue

      let kept = list.length
      while (kept > 0) {
        kept -= 1
        const candidate = {
          ...record,
          [key]: list.slice(0, kept),
          outputTruncated: {
            field: key,
            returned: kept,
            available: list.length,
            reason: `Result exceeded the ${limit}-character budget. Narrow the request to see the rest.`,
          },
        }

        const text = serialise(candidate)
        if (text.length <= limit) {
          return { value: candidate, characters: text.length, truncated: true }
        }
      }
    }
  }

  // Nothing trimmable, or trimming was not enough: say so rather than emitting
  // a truncated string that would parse as valid but mean something else.
  const replacement = {
    error: {
      code: 'output_too_large',
      message: `The result did not fit the ${limit}-character budget. Ask for fewer columns, fewer groups, or a smaller limit.`,
      characters: initial.length,
      limit,
    },
  }
  const text = serialise(replacement)

  return { value: replacement, characters: text.length, truncated: true }
}

/** Characters an agent would receive for this payload, for ledger accounting. */
export function measure(payload: unknown): number {
  return serialise(payload).length
}
