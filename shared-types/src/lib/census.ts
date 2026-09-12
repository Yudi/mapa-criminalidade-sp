export type CensusLevel = 'municipality' | 'neighborhood';

export interface CensusIndicator {
  key: string;
  group: string;
  label: string;
  value: number | null;
  unit: string;
  denominator: number | null;
  sourceUrl: string;
  variables: string;
  universe: string | null;
}

export interface CensusReleaseSummary {
  id: string;
  year: number;
  municipalityCount: number;
  neighborhoodCount: number;
}

export interface CensusAreaSummary {
  releaseId: string;
  level: CensusLevel;
  code: string;
  name: string;
  municipalityName: string;
}

export interface CensusAreaDetail extends CensusAreaSummary {
  year: number;
  population: number | null;
  areaKm2: number;
  bounds: number[];
  indicators: CensusIndicator[];
}

export interface CensusCrimeStats {
  occurrences: number;
  per100k: number | null;
  after: string;
  before: string;
}

/** A period count divided by census residents, never automatically annualized. */
export function occurrencesPer100k(
  count: number,
  population: number | null
): number | null {
  return Number.isFinite(count) &&
    count >= 0 &&
    population != null &&
    Number.isFinite(population) &&
    population > 0
    ? (count / population) * 100_000
    : null;
}
