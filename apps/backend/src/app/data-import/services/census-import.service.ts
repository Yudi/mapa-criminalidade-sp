import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { getDatabaseUrl } from '../../prisma/database-url.util';
import { PythonToolService } from './python-tool.service';
import {
  CensusImportArea,
  CensusImportRelease,
  CensusManifest,
  censusManifestSchema,
  readCensusAreas,
  validateCensusArtifact,
} from './census-import-artifact';

export type CensusImportPhase =
  | 'checking'
  | 'preparing'
  | 'validating'
  | 'loading'
  | 'completed';
export interface CensusImportResult {
  releaseId: string;
  outcome: 'imported' | 'repaired' | 'already-installed';
  areaCount?: number;
}

/** One release per deployment, using the same bounded import worker as crime data. */
@Injectable()
export class CensusImportService implements OnModuleDestroy {
  private readonly logger = new Logger(CensusImportService.name);
  private shuttingDown = false;
  private client?: Client;
  constructor(private readonly python: PythonToolService) {}

  async configuredRelease(): Promise<CensusManifest> {
    const path = await this.python.resolveAssetPath('census/manifest.json');
    const raw = await readFile(path);
    return {
      ...censusManifestSchema.parse(JSON.parse(raw.toString())),
      path,
      sha256: createHash('sha256').update(raw).digest('hex'),
    };
  }

  async ensureImported(
    releaseId: string,
    progress: (phase: CensusImportPhase) => Promise<void>
  ): Promise<CensusImportResult> {
    const manifest = await this.configuredRelease();
    if (manifest.id !== releaseId)
      throw new Error('Census job requires a different backend release');
    this.checkShutdown();
    const client = new Client({
      connectionString: getDatabaseUrl(),
      connectionTimeoutMillis: 10_000,
    });
    this.client = client;
    // Connection loss during the preparation stage must not cause an uncaught event.
    let connectionError: Error | undefined;
    client.on('error', (error) => {
      connectionError = error;
    });
    let directory: string | undefined;
    let transaction = false;
    try {
      await client.connect();
      await progress('checking');
      // Session lock covers downloads too; the DB transaction begins only after preparation.
      const {
        rows: [lock],
      } = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('census-import')) AS acquired"
      );
      if (!lock?.acquired) throw new Error('Another census import is running');
      const root = join(process.cwd(), 'temp', 'census');
      await this.clearInterruptedWorkspaces(root);
      const existing = await client.query<{ active: boolean }>(
        'SELECT active FROM census_releases WHERE id=$1',
        [manifest.id]
      );
      const installed = existing.rows[0];
      if (installed && (await this.isComplete(client, manifest))) {
        this.logger.log(
          `Census ${manifest.id} is complete; skipping all downloads and writes`
        );
        await progress('completed');
        return { releaseId, outcome: 'already-installed' };
      }
      this.checkShutdown();
      await mkdir(root, { recursive: true });
      directory = await mkdtemp(join(root, 'import-'));
      await progress('preparing');
      await this.python.runAssetScript(
        'census/prepare.py',
        ['--manifest', manifest.path, '--output', directory],
        30 * 60 * 1000
      );
      this.checkShutdown();
      if (connectionError) throw connectionError;
      await progress('validating');
      const release = await validateCensusArtifact(directory, manifest);
      await progress('loading');
      await client.query('BEGIN');
      transaction = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '60s'");
      if (installed) {
        // Repair the configured snapshot atomically. Other readers retain the
        // previous committed state until the whole replacement is validated.
        await client.query('DELETE FROM census_areas WHERE release_id=$1', [
          manifest.id,
        ]);
        await client.query('DELETE FROM census_releases WHERE id=$1', [
          manifest.id,
        ]);
      }
      await client.query(
        'INSERT INTO census_releases (id,year,state_code,manifest) VALUES ($1,$2,$3,$4)',
        [
          release.id,
          release.year,
          '35',
          JSON.stringify({ ...release, sourceManifestSha256: manifest.sha256 }),
        ]
      );
      for await (const area of readCensusAreas(directory, release)) {
        this.checkShutdown();
        await this.insertArea(client, release, area);
      }
      const {
        rows: [result],
      } = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM census_areas WHERE release_id=$1',
        [release.id]
      );
      const expected =
        release.counts.municipality + release.counts.neighborhood;
      if (
        result?.count !== expected ||
        !(await this.isComplete(client, manifest))
      ) {
        throw new Error('Census geometry or indicators import was incomplete');
      }
      this.checkShutdown();
      if (!installed || installed.active) {
        await client.query(
          'UPDATE census_releases SET active=false WHERE active'
        );
        await client.query(
          'UPDATE census_releases SET active=true WHERE id=$1',
          [release.id]
        );
      }
      await client.query('ANALYZE census_areas');
      await client.query('COMMIT');
      transaction = false;
      this.logger.log(`Completed census ${release.id}: ${expected} SP areas`);
      await progress('completed');
      return {
        releaseId,
        outcome: installed ? 'repaired' : 'imported',
        areaCount: expected,
      };
    } catch (error) {
      if (transaction) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      // Closing releases the advisory lock even after connection/transaction failure.
      await client.end().catch(() => undefined);
      if (this.client === client) this.client = undefined;
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  private async clearInterruptedWorkspaces(root: string): Promise<void> {
    const directories = await readdir(root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    );
    // The advisory lock guarantees no healthy census importer is using these.
    for (const entry of directories) {
      if (entry.isDirectory() && entry.name.startsWith('import-')) {
        await rm(join(root, entry.name), { recursive: true, force: true });
      }
    }
  }

  private async isComplete(
    client: Client,
    manifest: CensusManifest
  ): Promise<boolean> {
    const baseKeys = manifest.indicators.map((indicator) => ({
      key: indicator.key,
    }));
    const municipalityKeys = [
      ...baseKeys,
      ...Object.keys(manifest.education?.categories ?? {}).map((key) => ({
        key: `education${key}`,
      })),
    ];
    const { rows } = await client.query<{
      level: string;
      count: number;
      complete: boolean;
    }>(
      `
      SELECT level,count(*)::int AS count,
        bool_and(indicators @> CASE WHEN level='municipality' THEN $2::jsonb ELSE $3::jsonb END
          AND jsonb_array_length(indicators)=CASE WHEN level='municipality' THEN $4::int ELSE $5::int END) AS complete
      FROM census_areas WHERE release_id=$1 GROUP BY level`,
      [
        manifest.id,
        JSON.stringify(municipalityKeys),
        JSON.stringify(baseKeys),
        municipalityKeys.length,
        baseKeys.length,
      ]
    );
    return (
      rows.length === 2 &&
      rows.every(
        (row) =>
          row.complete &&
          row.count ===
            (row.level === 'municipality'
              ? manifest.expectedMunicipalities
              : manifest.expectedNeighborhoods)
      )
    );
  }

  private async insertArea(
    client: Client,
    release: CensusImportRelease,
    area: CensusImportArea
  ): Promise<void> {
    await client.query(
      `WITH geometry AS (
      SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($9),4326)) AS geom
    ) INSERT INTO census_areas (release_id,level,code,name,municipality_code,municipality_name,
      population,indicators,geom,geom_web,label_point,area_km2)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,geom,ST_Transform(geom,3857),
        ST_PointOnSurface(ST_Transform(geom,3857)),ST_Area(geom::geography)/1000000
      FROM geometry WHERE ST_IsValid(geom) AND NOT ST_IsEmpty(geom)`,
      [
        release.id,
        area.level,
        area.code,
        area.name,
        area.municipalityCode,
        area.municipalityName,
        area.population,
        JSON.stringify(area.indicators),
        JSON.stringify(area.geometry),
      ]
    );
  }

  private checkShutdown(): void {
    if (this.shuttingDown)
      throw new Error('Census import worker is shutting down');
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await this.client?.end().catch(() => undefined);
  }
}
