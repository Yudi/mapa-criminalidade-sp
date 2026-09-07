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
    SET source_tables = array_remove(source_tables, $1),
      feature_data = public.map_features_merge_source_data(feature_data, '{}'::jsonb, $1),
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
    `UPPER(${sourceTextExpression(
      config.columnMappings.num_bo
    )}) AS "__etl_sort_num_bo"`,
    `${sourceIntegerExpression(
      config.columnMappings.ano_bo
    )} AS "__etl_sort_ano_bo"`,
    `UPPER(${sourceTextExpression(
      config.columnMappings.delegacia
    )}) AS "__etl_sort_delegacia"`,
    `ROUND(${sourceNumberExpression(
      config.columnMappings.latitude
    )}, 6) AS "__etl_sort_latitude_bucket"`,
    `ROUND(${sourceNumberExpression(
      config.columnMappings.longitude
    )}, 6) AS "__etl_sort_longitude_bucket"`,
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
