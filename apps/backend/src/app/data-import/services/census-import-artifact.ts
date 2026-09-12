import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { z } from 'zod';

const numeric = z.number().finite().nonnegative();
const indicatorSchema = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  value: numeric.nullable(),
  unit: z.enum(['count', 'decimal', 'BRL']),
  denominator: numeric.nullable(),
  sourceUrl: z
    .url()
    .refine((value) => new URL(value).hostname.endsWith('.ibge.gov.br')),
  variables: z.string(),
  universe: z.string().nullable(),
});
const areaSchema = z.object({
  level: z.enum(['municipality', 'neighborhood']),
  code: z.string().regex(/^35\d{5}(\d{3})?$/),
  municipalityCode: z.string().regex(/^35\d{5}$/),
  name: z.string().min(1),
  municipalityName: z.string().min(1),
  population: numeric.int().nullable(),
  geometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.unknown()),
  }),
  indicators: z.array(indicatorSchema).min(1),
});
const releaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    year: z.number().int().min(2022).max(2200),
    stateCode: z.literal('35'),
    dataSha256: z.string().regex(/^[a-f0-9]{64}$/),
    counts: z.object({
      municipality: z.number().int().positive(),
      neighborhood: z.number().int().positive(),
    }),
  })
  .passthrough();
export const censusManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  year: z.number().int().min(2022).max(2200),
  stateCode: z.literal('35'),
  expectedMunicipalities: z.number().int().positive(),
  expectedNeighborhoods: z.number().int().positive(),
  indicators: z.array(z.object({ key: z.string().min(1) })).min(1),
  education: z
    .object({ categories: z.record(z.string(), z.string()) })
    .optional(),
});
export type CensusManifest = z.infer<typeof censusManifestSchema> & {
  sha256: string;
  path: string;
};
export type CensusImportArea = z.infer<typeof areaSchema>;
export type CensusImportRelease = z.infer<typeof releaseSchema>;

export async function* readCensusAreas(
  directory: string,
  release: CensusImportRelease
): AsyncGenerator<CensusImportArea> {
  const input = createReadStream(resolve(directory, 'areas.ndjson'));
  const lines = createInterface({ input, crlfDelay: Infinity });
  const seen = new Set<string>();
  const counts = { municipality: 0, neighborhood: 0 };
  try {
    for await (const line of lines) {
      const area = areaSchema.parse(JSON.parse(line));
      const key = `${area.level}:${area.code}`;
      if (
        seen.has(key) ||
        area.code.slice(0, 7) !== area.municipalityCode ||
        (area.level === 'municipality'
          ? area.code.length !== 7
          : area.code.length !== 10)
      ) {
        throw new Error(`Duplicate or inconsistent census geography: ${key}`);
      }
      const population = area.indicators.find(
        (item) => item.key === 'population'
      );
      if (
        !population ||
        population.value !== area.population ||
        new Set(area.indicators.map((item) => item.key)).size !==
          area.indicators.length
      ) {
        throw new Error(`Invalid census indicators: ${key}`);
      }
      seen.add(key);
      counts[area.level]++;
      yield area;
    }
    if (
      counts.municipality !== release.counts.municipality ||
      counts.neighborhood !== release.counts.neighborhood
    ) {
      throw new Error('Census release row count mismatch');
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function validateCensusArtifact(
  directory: string,
  manifest: CensusManifest
): Promise<CensusImportRelease> {
  const release = releaseSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'))
  );
  if (
    release.id !== manifest.id ||
    release.year !== manifest.year ||
    release.counts.municipality !== manifest.expectedMunicipalities ||
    release.counts.neighborhood !== manifest.expectedNeighborhoods
  )
    throw new Error('Census artifact does not match configured release');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(
    resolve(directory, 'areas.ndjson')
  ))
    hash.update(chunk);
  if (hash.digest('hex') !== release.dataSha256)
    throw new Error('Census data checksum mismatch');
  for await (const area of readCensusAreas(directory, release)) void area;
  return release;
}
