import { quoteIdentifier } from '../../../prisma/sql.utils';
import {
  LOCATION_COLUMN_MAPPINGS,
  OCCURRENCE_COLUMN_MAPPINGS,
  getSourceTableConfig,
} from '../../config/source-tables.config';
import {
  sourceIntegerExpression,
  sourceNumberExpression,
  sourceTextColumnExpression,
  sourceTextExpression,
} from '../../utils/source-sql.utils';

type SourceTableConfig = NonNullable<ReturnType<typeof getSourceTableConfig>>;

export function buildRemoveSourceTableFeaturesSql(): string {
  return `
    UPDATE map_features
    SET
      source_tables = array_remove(source_tables, $1),
      feature_data = (
        WITH remaining_records AS (
          SELECT COALESCE(jsonb_agg(record.value), '[]'::jsonb) AS records
          FROM jsonb_array_elements(
            COALESCE(feature_data->'records', '[]'::jsonb)
          ) AS record(value)
          WHERE record.value->>'source_table' <> $1
        ),
        remaining_rubricas AS (
          SELECT COALESCE(jsonb_agg(DISTINCT rubrica), '[]'::jsonb) AS all_rubricas
          FROM (
            SELECT to_jsonb(record.value->>'rubrica') AS rubrica
            FROM jsonb_array_elements(
              (SELECT records FROM remaining_records)
            ) AS record(value)
            WHERE NULLIF(record.value->>'rubrica', '') IS NOT NULL
          ) AS rubrica_rows
        )
        SELECT jsonb_build_object(
          'location',
          COALESCE(feature_data->'location', '{}'::jsonb),
          'occurrence',
          COALESCE(feature_data->'occurrence', '{}'::jsonb),
          'all_rubricas',
          remaining_rubricas.all_rubricas,
          'records',
          remaining_records.records,
          'summary',
          jsonb_build_object(
            'total_records',
            jsonb_array_length(remaining_records.records),
            'celulares_count',
            (
              SELECT COUNT(*)
              FROM jsonb_array_elements(remaining_records.records) AS record(value)
              WHERE record.value->>'type' = 'celular'
            ),
            'veiculos_count',
            (
              SELECT COUNT(*)
              FROM jsonb_array_elements(remaining_records.records) AS record(value)
              WHERE record.value->>'type' = 'veiculo'
            ),
            'objetos_count',
            (
              SELECT COUNT(*)
              FROM jsonb_array_elements(remaining_records.records) AS record(value)
              WHERE record.value->>'type' = 'objeto'
            ),
            'dados_criminais_count',
            (
              SELECT COUNT(*)
              FROM jsonb_array_elements(remaining_records.records) AS record(value)
              WHERE record.value->>'type' = 'dados_criminais'
            ),
            'produtividade_count',
            (
              SELECT COUNT(*)
              FROM jsonb_array_elements(remaining_records.records) AS record(value)
              WHERE record.value->>'type' IN (
                'produtividade_armas',
                'produtividade_entorpecentes',
                'produtividade_veiculos',
                'produtividade_pessoa'
              )
            )
          )
        )
        FROM remaining_records, remaining_rubricas
      ),
      updated_at = NOW()
    WHERE source_tables @> ARRAY[$1]::text[]
      AND cardinality(source_tables) > 1
  `;
}

export function buildSelectColumns(
  config: SourceTableConfig,
  columnSet: Set<string>
): string {
  const columns = new Set<string>();

  columns.add('id');

  Object.values(config.columnMappings).forEach((col) => {
    if (col && columnSet.has(col.toUpperCase())) {
      columns.add(quoteIdentifier(col));
    }
  });

  for (const alts of Object.values(LOCATION_COLUMN_MAPPINGS)) {
    for (const col of alts) {
      if (columnSet.has(col.toUpperCase())) {
        columns.add(quoteIdentifier(col));
      }
    }
  }

  for (const alts of Object.values(OCCURRENCE_COLUMN_MAPPINGS)) {
    for (const col of alts) {
      if (columnSet.has(col.toUpperCase())) {
        columns.add(quoteIdentifier(col));
      }
    }
  }

  const typeSpecificCols = getTypeSpecificColumns(config.recordType);
  for (const col of typeSpecificCols) {
    if (columnSet.has(col.toUpperCase())) {
      columns.add(quoteIdentifier(col));
    }
  }

  return Array.from(columns).join(', ');
}

export function buildProcessableRowsWhere(config: SourceTableConfig): string {
  return [
    `NULLIF(btrim(${sourceTextColumnExpression(
      config.columnMappings.num_bo
    )}), '') IS NOT NULL`,
    `${sourceIntegerExpression(config.columnMappings.ano_bo)} IS NOT NULL`,
    `${sourceNumberExpression(config.columnMappings.latitude)} IS NOT NULL`,
    `${sourceNumberExpression(config.columnMappings.longitude)} IS NOT NULL`,
  ].join('\n          AND ');
}

export function buildSourceSortSelectColumns(
  config: SourceTableConfig
): string {
  return [
    `${sourceTextExpression(
      config.columnMappings.num_bo
    )} AS "__etl_sort_num_bo"`,
    `${sourceIntegerExpression(
      config.columnMappings.ano_bo
    )} AS "__etl_sort_ano_bo"`,
    `${sourceTextExpression(
      config.columnMappings.delegacia
    )} AS "__etl_sort_delegacia"`,
    `ROUND(${sourceNumberExpression(
      config.columnMappings.latitude
    )}, 4) AS "__etl_sort_latitude_bucket"`,
    `ROUND(${sourceNumberExpression(
      config.columnMappings.longitude
    )}, 4) AS "__etl_sort_longitude_bucket"`,
  ].join(', ');
}

export function getTypeSpecificColumns(recordType: string): string[] {
  switch (recordType) {
    case 'celular':
      return [
        'DESCR_MODO_OBJETO',
        'DESCR_TIPO_OBJETO',
        'DESCR_SUBTIPO_OBJETO',
        'MARCA_OBJETO',
        'QUANTIDADE_OBJETO',
        'FLAG_BLOQUEIO',
        'FLAG_DESBLOQUEIO',
      ];
    case 'veiculo':
      return [
        'DESCR_OCORRENCIA_VEICULO',
        'DESCR_TIPO_VEICULO',
        'DESCR_MARCA_VEICULO',
        'DESC_COR_VEICULO',
        'PLACA_VEICULO',
        'ANO_FABRICACAO',
        'ANO_MODELO',
      ];
    case 'objeto':
      return [
        'DESCR_MODO_OBJETO',
        'DESCR_TIPO_OBJETO',
        'DESCR_SUBTIPO_OBJETO',
        'MARCA_OBJETO',
        'QUANTIDADE_OBJETO',
      ];
    case 'dados_criminais':
      return ['NATUREZA_APURADA', 'DESCR_CONDUTA'];
    case 'produtividade_armas':
      return [
        'DESCRICAO_APRESENTACAO',
        'DESC_OBJETO_MODO',
        'DESC_ARMA_FOGO',
        'ARMA_NOME_MARCA',
        'CALIBRE',
      ];
    case 'produtividade_entorpecentes':
      return [
        'DESCRICAO_APRESENTACAO',
        'DESCR_TOXICO',
        'QTDE_GRAMAS_ARRED',
      ];
    case 'produtividade_veiculos':
      return [
        'DESCRICAO_APRESENTACAO',
        'DESCR_OCORRENCIA_VEICULO',
        'DESCR_TIPO_VEICULO',
        'DESCR_MARCA_VEICULO',
        'DESC_COR_VEICULO',
        'PLACA_VEICULO',
        'ANO_FABRICACAO',
        'ANO_MODELO',
      ];
    case 'produtividade_pessoa':
      return [
        'DESCRICAO_APRESENTACAO',
        'DESCR_TIPO_PESSOA',
        'SEXO_PESSOA',
        'IDADE_PESSOA',
        'COR_CUTIS',
        'COR_CURTIS',
        'DESCR_PROFISSAO',
        'DESCR_GRAU_INSTRUCAO',
        'NACIONALIDADE_PESSOA',
      ];
    default:
      return [];
  }
}
