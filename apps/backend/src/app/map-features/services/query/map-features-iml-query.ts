import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  qualifiedTableName,
  quoteIdentifier,
  quoteLiteral,
} from '../../../prisma/sql.utils';
import { ImlRecord } from '../../types/map-features.types';
import { normalizeImlLookupValue } from './map-features-query-sql';

export async function getImlRecordsByBo(
  prisma: PrismaService,
  numBo: string,
  anoBo: number,
  delegacia: string | null
): Promise<ImlRecord[]> {
  if (!delegacia) {
    return [];
  }

  const tables = await prisma.$queryRaw<{ table_name: string }[]>(
    Prisma.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'raw'
        AND table_name LIKE 'registro_obitos_iml_%'
      ORDER BY table_name
    `
  );
  const tableNames = tables
    .map((row) => row.table_name)
    .filter((tableName) => /^registro_obitos_iml_\d{4}$/.test(tableName));

  if (tableNames.length === 0) {
    return [];
  }

  const selects = tableNames.map(
    (tableName) => `
      SELECT
        id AS source_id,
        ${quoteLiteral(tableName)} AS source_table,
        ${quoteIdentifier('DATA_ENTRADA_IML')} AS data_entrada_iml,
        ${quoteIdentifier('ANO_BO')} AS ano_bo,
        ${quoteIdentifier('NUM_BO')} AS num_bo,
        ${quoteIdentifier('DELEGACIA_REGISTRO')} AS delegacia_registro,
        ${quoteIdentifier('NUMERO_LAUDO')} AS numero_laudo,
        ${quoteIdentifier('ANO_LAUDO')} AS ano_laudo,
        ${quoteIdentifier('IDADE_VITIMA')} AS idade_vitima,
        ${quoteIdentifier('TIPO_IDADE')} AS tipo_idade,
        ${quoteIdentifier('CONCLUSAO')} AS conclusao,
        ${quoteIdentifier('DECLARACAO_OBITO')} AS declaracao_obito,
        ${quoteIdentifier('CAUSA_MORTIS')} AS causa_mortis
      FROM ${qualifiedTableName(tableName)}
      WHERE ${quoteIdentifier('NUM_BO_NORMALIZED')} = $1
        AND ${quoteIdentifier('ANO_BO')} = $2
        AND ${quoteIdentifier('DELEGACIA_REGISTRO_NORMALIZED')} = $3
    `
  );
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      source_id: number;
      source_table: string;
      data_entrada_iml: string | null;
      ano_bo: string | null;
      num_bo: string | null;
      delegacia_registro: string | null;
      numero_laudo: string | null;
      ano_laudo: string | null;
      idade_vitima: string | null;
      tipo_idade: string | null;
      conclusao: string | null;
      declaracao_obito: string | null;
      causa_mortis: string | null;
    }>
  >(
    `SELECT * FROM (${selects.join(
      ' UNION ALL '
    )}) AS iml_records
    ORDER BY
      CASE
        WHEN data_entrada_iml ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
          THEN to_timestamp(data_entrada_iml, 'DD/MM/YYYY HH24:MI:SS')
        WHEN data_entrada_iml ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}$'
          THEN to_timestamp(data_entrada_iml, 'DD/MM/YYYY HH24:MI')
        WHEN data_entrada_iml ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
          THEN to_timestamp(data_entrada_iml, 'DD/MM/YYYY')
        ELSE NULL
      END NULLS LAST,
      source_table,
      source_id`,
    normalizeImlLookupValue(numBo),
    String(anoBo),
    normalizeImlLookupValue(delegacia)
  );

  return rows.map((row) => ({
    sourceId: Number(row.source_id),
    sourceTable: row.source_table,
    dataEntradaIml: row.data_entrada_iml,
    anoBo: row.ano_bo,
    numBo: row.num_bo,
    delegaciaRegistro: row.delegacia_registro,
    numeroLaudo: row.numero_laudo,
    anoLaudo: row.ano_laudo,
    idadeVitima: row.idade_vitima,
    tipoIdade: row.tipo_idade,
    conclusao: row.conclusao,
    declaracaoObito: row.declaracao_obito,
    causaMortis: row.causa_mortis,
  }));
}
