/**
 * The complete tool surface Cleanroom offers an agent.
 *
 * Eleven tools: five that read the data, six that write to the shared report.
 * Two of them stop and ask a human before doing anything.
 */

import { DATA_TOOLS } from './dataTools'
import { REPORT_TOOLS } from './reportTools'
import type { ToolSpec } from './types'

export const ALL_TOOLS: ToolSpec[] = [...DATA_TOOLS, ...REPORT_TOOLS]

export function findTool(name: string): ToolSpec | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name)
}

export { DATA_TOOLS } from './dataTools'
export { REPORT_TOOLS } from './reportTools'
export type { ToolSpec, RiskClass } from './types'
