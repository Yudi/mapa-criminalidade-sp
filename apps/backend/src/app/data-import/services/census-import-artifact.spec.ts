import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CensusManifest,
  validateCensusArtifact,
} from './census-import-artifact';

const manifest: CensusManifest = {
  id: 'test-census',
  year: 2022,
  stateCode: '35',
  expectedMunicipalities: 1,
  expectedNeighborhoods: 1,
  indicators: [{ key: 'population' }],
  sha256: 'a'.repeat(64),
  path: 'unused',
};
const indicator = {
  key: 'population',
  group: 'População',
  label: 'População residente',
  value: 10,
  unit: 'count',
  denominator: null,
  sourceUrl: 'https://ftp.ibge.gov.br/test',
  variables: 'V0001',
  universe: null,
};
const area = {
  level: 'municipality',
  code: '3500105',
  municipalityCode: '3500105',
  name: 'Teste',
  municipalityName: 'Teste',
  population: 10,
  geometry: { type: 'Polygon', coordinates: [] },
  indicators: [indicator],
};

describe('Backend census artifact validation', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'census-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  async function artifact(rows: unknown[]) {
    const data = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await writeFile(join(directory, 'areas.ndjson'), data);
    await writeFile(
      join(directory, 'release.json'),
      JSON.stringify({
        id: manifest.id,
        year: 2022,
        stateCode: '35',
        counts: { municipality: 1, neighborhood: 1 },
        dataSha256: createHash('sha256').update(data).digest('hex'),
      })
    );
  }
  it('validates a complete state-only release before writing', async () => {
    await artifact([
      area,
      { ...area, level: 'neighborhood', code: '3500105001' },
    ]);
    await expect(
      validateCensusArtifact(directory, manifest)
    ).resolves.toMatchObject({ id: manifest.id });
  });
  it('rejects truncated counts even when the file hash is valid', async () => {
    await artifact([area]);
    await expect(validateCensusArtifact(directory, manifest)).rejects.toThrow(
      'row count mismatch'
    );
  });
  it('rejects altered files before parsing or loading', async () => {
    await artifact([area]);
    await writeFile(join(directory, 'areas.ndjson'), 'tampered\n');
    await expect(validateCensusArtifact(directory, manifest)).rejects.toThrow(
      'checksum mismatch'
    );
  });
  it('rejects a population that disagrees with its indicator', async () => {
    await artifact([{ ...area, population: 20 }]);
    await expect(validateCensusArtifact(directory, manifest)).rejects.toThrow(
      'Invalid census indicators'
    );
  });
});
