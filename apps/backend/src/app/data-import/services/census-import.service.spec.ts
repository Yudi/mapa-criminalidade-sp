import { Client } from 'pg';
import { CensusImportService } from './census-import.service';
import { PythonToolService } from './python-tool.service';
import {
  CensusManifest,
  readCensusAreas,
  validateCensusArtifact,
} from './census-import-artifact';

jest.mock('pg', () => ({ Client: jest.fn() }));
jest.mock('./census-import-artifact', () => ({
  ...jest.requireActual('./census-import-artifact'),
  validateCensusArtifact: jest.fn(),
  readCensusAreas: jest.fn(),
}));
const manifest: CensusManifest = {
  id: 'ibge-test',
  year: 2022,
  stateCode: '35',
  expectedMunicipalities: 645,
  expectedNeighborhoods: 2170,
  indicators: [{ key: 'population' }],
  sha256: 'a'.repeat(64),
  path: '/bundled/manifest.json',
};
const complete = [
  { level: 'municipality', count: 645, complete: true },
  { level: 'neighborhood', count: 2170, complete: true },
];

describe('Census backend import orchestration', () => {
  function setup(installed = true, isComplete = true) {
    let checks = 0;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock'))
        return { rows: [{ acquired: true }] };
      if (sql.startsWith('SELECT active'))
        return { rows: installed ? [{ active: true }] : [] };
      if (sql.includes('GROUP BY level'))
        return { rows: checks++ === 0 && !isComplete ? [] : complete };
      if (sql.startsWith('SELECT count')) return { rows: [{ count: 2815 }] };
      return { rows: [] };
    });
    const client = {
      connect: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      query,
    };
    (Client as unknown as jest.Mock).mockImplementation(() => client);
    const python = {
      runAssetScript: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };
    const service = new CensusImportService(
      python as unknown as PythonToolService
    );
    jest.spyOn(service, 'configuredRelease').mockResolvedValue(manifest);
    jest
      .mocked(validateCensusArtifact)
      .mockResolvedValue({
        id: manifest.id,
        year: 2022,
        stateCode: '35',
        counts: { municipality: 645, neighborhood: 2170 },
        dataSha256: 'b'.repeat(64),
      });
    jest.mocked(readCensusAreas).mockImplementation(async function* () {
      yield* [];
    });
    return {
      service,
      python,
      client,
      progress: jest.fn().mockResolvedValue(undefined),
    };
  }
  beforeEach(() => jest.clearAllMocks());

  it('checks local completeness and performs no download or write when installed', async () => {
    const { service, python, client, progress } = setup();
    await expect(
      service.ensureImported(manifest.id, progress)
    ).resolves.toEqual({
      releaseId: manifest.id,
      outcome: 'already-installed',
    });
    expect(python.runAssetScript).not.toHaveBeenCalled();
    expect(
      client.query.mock.calls.every(
        ([sql]) => sql.startsWith('SELECT') || sql.trim().startsWith('SELECT')
      )
    ).toBe(true);
    expect(client.end).toHaveBeenCalled();
  });
  it('downloads only a missing release and publishes after validation in one transaction', async () => {
    const { service, python, client, progress } = setup(false);
    await expect(
      service.ensureImported(manifest.id, progress)
    ).resolves.toMatchObject({ outcome: 'imported' });
    expect(python.runAssetScript).toHaveBeenCalledWith(
      'census/prepare.py',
      expect.arrayContaining(['--manifest', manifest.path]),
      1800000
    );
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements.indexOf('BEGIN')).toBeLessThan(
      statements.indexOf('UPDATE census_releases SET active=false WHERE active')
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.some((sql) => sql.includes('map_features'))).toBe(false);
  });
  it('repairs an incomplete release rather than treating its metadata row as success', async () => {
    const { service, client, progress } = setup(true, false);
    await expect(
      service.ensureImported(manifest.id, progress)
    ).resolves.toMatchObject({ outcome: 'repaired' });
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(
      statements.indexOf('DELETE FROM census_areas WHERE release_id=$1')
    ).toBeGreaterThan(statements.indexOf('BEGIN'));
    expect(statements.at(-1)).toBe('COMMIT');
  });
  it('treats missing indicators as incomplete even when all polygon rows exist', async () => {
    const { service, client, progress } = setup(true);
    const original = client.query.getMockImplementation();
    let checks = 0;
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('GROUP BY level') && checks++ === 0)
        return { rows: complete.map((row) => ({ ...row, complete: false })) };
      if (!original) throw new Error('Missing query mock');
      return original(sql);
    });
    await expect(
      service.ensureImported(manifest.id, progress)
    ).resolves.toMatchObject({ outcome: 'repaired' });
  });
  it('does not reactivate an older inactive release while repairing it', async () => {
    const { service, client, progress } = setup(true, false);
    const original = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT active')) return { rows: [{ active: false }] };
      if (!original) throw new Error('Missing query mock');
      return original(sql);
    });
    await expect(
      service.ensureImported(manifest.id, progress)
    ).resolves.toMatchObject({ outcome: 'repaired' });
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.startsWith('UPDATE census_releases SET active')
      )
    ).toBe(false);
  });
  it('leaves published data untouched if preparation fails', async () => {
    const { service, python, client, progress } = setup(false);
    python.runAssetScript.mockRejectedValue(new Error('IBGE unavailable'));
    await expect(service.ensureImported(manifest.id, progress)).rejects.toThrow(
      'IBGE unavailable'
    );
    expect(client.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(
      false
    );
    expect(client.end).toHaveBeenCalled();
  });
  it('rolls back a failed load and never switches the active release', async () => {
    const { service, client, progress } = setup(false);
    const original = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT INTO census_releases'))
        throw new Error('write failed');
      if (!original) throw new Error('Missing query mock');
      return original(sql);
    });
    await expect(service.ensureImported(manifest.id, progress)).rejects.toThrow(
      'write failed'
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.startsWith('UPDATE census_releases SET active')
      )
    ).toBe(false);
  });
  it('does not download when another importer owns the lock', async () => {
    const { service, python, client, progress } = setup(false);
    client.query.mockResolvedValue({ rows: [{ acquired: false }] });
    await expect(service.ensureImported(manifest.id, progress)).rejects.toThrow(
      'Another census import'
    );
    expect(python.runAssetScript).not.toHaveBeenCalled();
  });
});
