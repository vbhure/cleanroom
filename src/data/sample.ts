/**
 * The sample dataset.
 *
 * Invented names, invented deals. Its shape is deliberate: four regions of
 * exactly five rows each, so that grouping by region clears the default
 * k-anonymity threshold of five while grouping by individual sales rep does
 * not. Loading it and asking for revenue by rep is the shortest honest
 * demonstration that the threshold is doing something.
 *
 * It lives here rather than beside a component because two places offer it:
 * the drop zone in the left rail, and the empty report, which is the first
 * thing anyone sees.
 */

import { buildDataset } from './dataset'
import type { Dataset } from './types'

export const SAMPLE_DATASET_NAME = 'sample_sales.csv'

export const SAMPLE_CSV = `region,rep,deal_size,closed_on,segment,status
North,Ada Lovelace,12500,2026-01-05,Enterprise,won
North,Ada Lovelace,8200,2026-01-19,Mid-market,won
North,Bob Chen,3100,2026-01-20,SMB,lost
South,Cleo Marsh,41000,2026-02-02,Enterprise,won
South,Cleo Marsh,5400,2026-02-15,SMB,won
South,Bob Chen,7300,2026-02-18,Mid-market,lost
East,Dev Rao,96000,2026-01-30,Enterprise,won
East,Dev Rao,2200,2026-03-04,SMB,won
East,Eve Nakamura,15800,2026-03-11,Mid-market,won
West,Eve Nakamura,,2026-03-20,Mid-market,open
West,Priya Shah,22400,2026-03-22,Enterprise,won
West,Priya Shah,1900,2026-04-02,SMB,lost
North,Ada Lovelace,33000,2026-04-14,Enterprise,won
South,Cleo Marsh,4700,2026-04-19,SMB,open
East,Dev Rao,58000,2026-05-03,Enterprise,won
West,Priya Shah,9100,2026-05-12,Mid-market,won
North,Bob Chen,6400,2026-05-21,SMB,won
South,Cleo Marsh,275000,2026-06-01,Enterprise,won
East,Eve Nakamura,3300,2026-06-09,SMB,lost
West,Priya Shah,11200,2026-06-18,Mid-market,won`

/** Builds the sample, avoiding an id collision with anything already loaded. */
export function buildSampleDataset(existingIds: readonly string[]): Dataset {
  return buildDataset({
    name: SAMPLE_DATASET_NAME,
    text: SAMPLE_CSV,
    existingIds,
  })
}
