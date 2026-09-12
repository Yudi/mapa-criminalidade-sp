import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { AggregatedFeature } from './etl/map-features-etl-aggregator';
import { DatabaseExecutor } from './etl/map-features-etl-config';
import { MapFeaturesEtlService } from './map-features-etl.service';
import { MapFeaturesQueryService } from './map-features-query.service';

// tools/test-postgis-contract.mjs supplies a disposable, migrated database.
const describePostgis = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describePostgis('ETL identity across source replacement (PostGIS)', () => {
  it('retains existing location IDs, removes vanished locations, and assigns new IDs', async () => {
    const client = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await client.connect();
    try {
      const identity = await client.query<{ name: string }>(
        'SELECT current_database() AS name'
      );
      expect(identity.rows[0].name.endsWith('_test')).toBe(true);
      await client.query('BEGIN');
      const table = 'celulares_identity_test';
      const feature = (hash: string): AggregatedFeature => ({
        num_bo: 'IDENTITY-REGRESSION',
        ano_bo: 2026,
        delegacia: null,
        latitude: -23.55,
        longitude: -46.63,
        location_hash: hash,
        category: 'Furto',
        rubrica_for_styling: 'Furto',
        data_ocorrencia: new Date('2026-03-01T00:00:00Z'),
        source_tables: [table],
        feature_data: {
          location: {},
          occurrence: {},
          all_rubricas: ['Furto'],
          records: [{ type: 'celular', source_table: table, source_id: 1 }],
          summary: {
            total_records: 1,
            celulares_count: 1,
            veiculos_count: 0,
            objetos_count: 0,
            dados_criminais_count: 0,
            produtividade_count: 0,
          },
        },
      });
      const db = {
        $executeRawUnsafe: async (sql: string, ...values: unknown[]) =>
          (await client.query(sql, values)).rowCount ?? 0,
      } as DatabaseExecutor;
      const service = new MapFeaturesEtlService(
        {} as PrismaService,
        {} as MapFeaturesQueryService
      ) as unknown as {
        removeSourceTableFeatures(
          table: string,
          db: DatabaseExecutor
        ): Promise<void>;
        upsertFeatures(
          features: Map<string, AggregatedFeature>,
          db: DatabaseExecutor
        ): Promise<number>;
      };
      const publish = async (hashes: string[]) => {
        await service.removeSourceTableFeatures(table, db);
        await service.upsertFeatures(
          new Map(hashes.map((hash) => [hash, feature(hash)])),
          db
        );
        const result = await client.query<{
          id: string;
          location_hash: string;
        }>('SELECT id, location_hash FROM map_features WHERE num_bo = $1', [
          'IDENTITY-REGRESSION',
        ]);
        // The enclosing rollback isolates the fixture; real publications drop
        // this transaction-local snapshot automatically at commit.
        await client.query('DROP TABLE pg_temp.map_feature_previous_ids');
        return new Map(result.rows.map((row) => [row.location_hash, row.id]));
      };

      const initial = await publish(['kept', 'removed']);
      const refreshed = await publish(['kept', 'new']);
      const repeated = await publish(['kept', 'new']);

      expect(refreshed.get('kept')).toBe(initial.get('kept'));
      expect(refreshed.has('removed')).toBe(false);
      expect(refreshed.get('new')).toBeDefined();
      expect(refreshed.get('new')).not.toBe(initial.get('removed'));
      expect(repeated).toEqual(refreshed);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
