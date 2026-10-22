import { Client } from 'pg';
import { Prisma } from '../../../../generated/prisma/client';
import { DatabaseService } from '../../../data-import/services/database.service';
import { RustToolService } from '../../../data-import/services/rust-tool.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { qualifiedTableName } from '../../../prisma/sql.utils';
import { modernBoExpression } from '../../../shared/bo-identity.utils';
import { getImlRecordsByBo } from './map-features-iml-query';

const describePostgres = process.env.IML_TEST_DATABASE_URL
  ? describe
  : describe.skip;
const imlTables = ['registro_obitos_iml_2025', 'registro_obitos_iml_2026'];

interface QueryPlan {
  'Index Name'?: string;
  Plans?: QueryPlan[];
}

function planIndexes(plan: QueryPlan): string[] {
  return [
    ...(plan['Index Name'] ? [plan['Index Name']] : []),
    ...(plan.Plans ?? []).flatMap(planIndexes),
  ];
}

// This lane creates only transactional fixtures, never applies migrations, and
// requires an empty disposable database so it cannot touch application tables.
describePostgres('IML BO identity and indexed lookup (PostgreSQL)', () => {
  let client: Client;
  let prisma: PrismaService;
  let lastQuery: { sql: string; parameters: unknown[] };
  let fixturesReady = false;

  beforeAll(async () => {
    client = new Client({
      connectionString: process.env.IML_TEST_DATABASE_URL,
    });
    await client.connect();
    const {
      rows: [identity],
    } = await client.query<{ name: string; tables: number }>(`
      SELECT current_database() AS name,
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema IN ('public', 'raw') AND table_type = 'BASE TABLE') AS tables
    `);
    expect(identity.name.endsWith('_test')).toBe(true);
    expect(identity.tables).toBe(0);
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS raw');
    await client.query(
      'CREATE TABLE public.map_features (num_bo text, ano_bo integer, delegacia text)'
    );
    const mapBo = modernBoExpression('num_bo');
    await client.query(`CREATE INDEX idx_map_features_modern_bo_unit
      ON public.map_features ((${mapBo}), ano_bo, delegacia)
      WHERE ${mapBo} IS NOT NULL`);
    prisma = {
      $queryRaw: async (query: Prisma.Sql) =>
        (await client.query(query.text, query.values)).rows,
      $queryRawUnsafe: async (sql: string, ...parameters: unknown[]) => {
        lastQuery = { sql, parameters };
        return (await client.query(sql, parameters)).rows;
      },
      $executeRawUnsafe: async (sql: string) =>
        (await client.query(sql)).rowCount,
    } as unknown as PrismaService;
    const database = new DatabaseService(prisma, {} as RustToolService);

    const columns = [
      'DATA_ENTRADA_IML',
      'ANO_BO',
      'NUM_BO',
      'NUM_BO_NORMALIZED',
      'DELEGACIA_REGISTRO',
      'DELEGACIA_REGISTRO_NORMALIZED',
      'NUMERO_LAUDO',
      'ANO_LAUDO',
      'IDADE_VITIMA',
      'TIPO_IDADE',
      'CONCLUSAO',
      'DECLARACAO_OBITO',
      'CAUSA_MORTIS',
    ];
    for (const table of imlTables) {
      await client.query(`CREATE TABLE ${qualifiedTableName(table)} (
        id integer PRIMARY KEY, ${columns
          .map((column) => `"${column}" text`)
          .join(', ')}
      )`);
      // Representative unrelated rows let the planner choose indexes naturally.
      await client.query(`INSERT INTO ${qualifiedTableName(table)}
        (id, "NUM_BO", "NUM_BO_NORMALIZED", "ANO_BO",
          "DELEGACIA_REGISTRO", "DELEGACIA_REGISTRO_NORMALIZED")
        SELECT 10000 + n, 'ZZ' || lpad(n::text, 4, '0'), 'ZZ' || lpad(n::text, 4, '0'),
          '2025', 'FILLER', 'FILLER' FROM generate_series(1, 9000) n`);
      await database.ensureImlLookupIndex(table);
      await client.query(`ANALYZE ${qualifiedTableName(table)}`);
    }
    await client.query(`INSERT INTO public.map_features
      SELECT 'ZZ' || lpad(n::text, 4, '0'), 2025, 'FILLER' FROM generate_series(1, 9000) n`);
    await client.query('ANALYZE public.map_features');
    fixturesReady = true;
  }, 30_000);

  beforeEach(async () => {
    if (!fixturesReady) throw new Error('IML fixtures were not initialized');
    for (const table of imlTables) {
      await client.query(
        `DELETE FROM ${qualifiedTableName(table)} WHERE id < 10000`
      );
    }
    await client.query(`DELETE FROM public.map_features
      WHERE delegacia <> 'FILLER' OR delegacia IS NULL`);
    await client.query(`INSERT INTO public.map_features VALUES
      ('BQ4691', 2025, '24º D.P. PONTE RASA'),
      ('BQ4691-3', 2025, '24 D P Ponte Rása')`);
    for (const [index, table] of imlTables.entries()) {
      await client.query(
        `INSERT INTO ${qualifiedTableName(table)}
        (id, "NUM_BO", "NUM_BO_NORMALIZED", "ANO_BO", "DELEGACIA_REGISTRO",
          "DELEGACIA_REGISTRO_NORMALIZED", "DATA_ENTRADA_IML", "DECLARACAO_OBITO")
        VALUES ($1, $2, $3, '2025', '24 D.P. - ERM. MATARAZZO',
          '24 D P ERM MATARAZZO', $4, 'synthetic-certificate')`,
        [
          index + 1,
          `BQ4691-${index + 1}`,
          `BQ4691 ${index + 1}`,
          index ? '01/02/2026 08:00:00' : '09/04/2025 07:56:00',
        ]
      );
    }
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    }
  });

  it('recovers all editions across IML years, keeps the BO year exact, and retains raw records', async () => {
    await client.query(`INSERT INTO raw.registro_obitos_iml_2026
      (id, "NUM_BO", "NUM_BO_NORMALIZED", "ANO_BO", "DELEGACIA_REGISTRO_NORMALIZED")
      VALUES (3, 'BQ4691-4', 'BQ4691 4', '2026', 'OTHER UNIT'),
        (4, 'BQ4691/2025', 'BQ4691 2025', '2025', 'OTHER UNIT'),
        (5, 'BQ4691-extra', 'BQ4691 EXTRA', '2025', 'OTHER UNIT'),
        (6, 'BQ4691-0', 'BQ4691 0', '2025', 'OTHER UNIT'),
        (7, 'BQ4691-2', 'BQ4691 2', '2025', '')`);

    const result = await getImlRecordsByBo(
      prisma,
      'BQ4691-3',
      2025,
      '24º D.P. PONTE RASA'
    );

    expect(result.map((row) => [row.sourceTable, row.numBo])).toEqual([
      ['registro_obitos_iml_2025', 'BQ4691-1'],
      ['registro_obitos_iml_2026', 'BQ4691-2'],
    ]);
  });

  it('rejects conflicting IML units in another edition', async () => {
    await client.query(`UPDATE raw.registro_obitos_iml_2026
      SET "DELEGACIA_REGISTRO_NORMALIZED" = 'OTHER UNIT' WHERE id = 2`);
    await expect(
      getImlRecordsByBo(prisma, 'BQ4691', 2025, '24º D.P. PONTE RASA')
    ).resolves.toEqual([]);
  });

  it('checks map ambiguity across editions and all locations', async () => {
    await client.query(
      "INSERT INTO public.map_features VALUES ('BQ4691-4', 2025, 'OTHER UNIT')"
    );
    await expect(
      getImlRecordsByBo(prisma, 'BQ4691-3', 2025, '24º D.P. PONTE RASA')
    ).resolves.toEqual([]);
  });

  it('prefers exact unit matches without merging conflicting groups from other editions', async () => {
    await client.query(`UPDATE raw.registro_obitos_iml_2026
      SET "DELEGACIA_REGISTRO_NORMALIZED" = '24 D P PONTE RASA',
        "DELEGACIA_REGISTRO" = '24º D.P. PONTE RASA' WHERE id = 2`);
    await client.query(
      "INSERT INTO public.map_features VALUES ('BQ4691-4', 2025, 'OTHER UNIT')"
    );

    const result = await getImlRecordsByBo(
      prisma,
      'BQ4691',
      2025,
      '24º D.P. PONTE RASA'
    );

    expect(result.map((row) => row.numBo)).toEqual(['BQ4691-2']);
  });

  it('preserves strict unit matching for numeric BOs even in recent years', async () => {
    await client.query(`INSERT INTO raw.registro_obitos_iml_2025
      (id, "NUM_BO", "NUM_BO_NORMALIZED", "ANO_BO", "DELEGACIA_REGISTRO_NORMALIZED")
      VALUES (3, '1', '1', '2025', 'UNIT A'), (4, '1', '1', '2025', 'UNIT B')`);
    const result = await getImlRecordsByBo(prisma, '1', 2025, 'UNIT A');
    expect(result.map((row) => row.sourceId)).toEqual([3]);
    await expect(
      getImlRecordsByBo(prisma, '1', 2025, 'UNIT C')
    ).resolves.toEqual([]);
  });

  it('uses the canonical raw and map indexes with a generic prepared plan', async () => {
    await getImlRecordsByBo(prisma, 'BQ4691-3', 2025, '24º D.P. PONTE RASA');
    await client.query('SET LOCAL plan_cache_mode = force_generic_plan');
    await client.query(
      `PREPARE iml_modern_lookup(text, text) AS ${lastQuery.sql}`
    );
    const result = await client.query<{
      'QUERY PLAN': Array<{ Plan: QueryPlan }>;
    }>("EXPLAIN (FORMAT JSON) EXECUTE iml_modern_lookup('BQ4691', '2025')");
    const indexes = planIndexes(result.rows[0]['QUERY PLAN'][0].Plan);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_registro_obitos_iml_2025_modern_bo_lookup',
        'idx_registro_obitos_iml_2026_modern_bo_lookup',
        'idx_map_features_modern_bo_unit',
      ])
    );
    await client.query('DEALLOCATE iml_modern_lookup');
  });

  it('retains the legacy partial indexes with a generic prepared plan', async () => {
    await getImlRecordsByBo(prisma, '1', 2021, 'UNIT A');
    await client.query('SET LOCAL plan_cache_mode = force_generic_plan');
    await client.query(
      `PREPARE iml_legacy_lookup(text, text, text) AS ${lastQuery.sql}`
    );
    const result = await client.query<{
      'QUERY PLAN': Array<{ Plan: QueryPlan }>;
    }>(
      "EXPLAIN (FORMAT JSON) EXECUTE iml_legacy_lookup('1', '2021', 'UNIT A')"
    );
    expect(planIndexes(result.rows[0]['QUERY PLAN'][0].Plan)).toEqual(
      expect.arrayContaining([
        'idx_registro_obitos_iml_2025_bo_lookup',
        'idx_registro_obitos_iml_2026_bo_lookup',
      ])
    );
    await client.query('DEALLOCATE iml_legacy_lookup');
  });
});
