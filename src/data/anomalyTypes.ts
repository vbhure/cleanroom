/**
 * Anomaly shapes, kept separate from the detectors so the tool layer can
 * import the types without pulling in the detection code.
 */

export type AnomalyKind =
  | 'outliers'
  | 'missing'
  | 'duplicates'
  | 'type_violations'
  | 'gaps'
  | 'constant'

export interface Anomaly {
  kind: AnomalyKind
  /** Absent for whole-row findings such as duplicates. */
  column?: string
  severity: 'info' | 'warning'
  /** One sentence, written to be read aloud by an agent. */
  summary: string
  /** Aggregates only — counts, rates and bounds, never a text cell value. */
  detail?: Record<string, unknown>
}
