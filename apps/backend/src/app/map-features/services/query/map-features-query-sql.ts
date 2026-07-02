import { Prisma } from '../../../../generated/prisma/client';
import {
  MapFeaturesFilterParams,
} from '../../types/map-features.types';
import { normalizeStringList } from './map-features-query-cache';

export const PERIOD_SQL = `NULLIF(periodo_normalized, '')`;
export const PERIOD_KEY_SQL = PERIOD_SQL;
export const PERIOD_LABEL_SQL = `
  CASE ${PERIOD_KEY_SQL}
    WHEN 'de madrugada' THEN 'De madrugada'
    WHEN 'pela manha' THEN 'Pela manhã'
    WHEN 'a tarde' THEN 'À tarde'
    WHEN 'a noite' THEN 'À noite'
    WHEN 'em hora incerta' THEN 'Em hora incerta'
    ELSE upper(substring(${PERIOD_KEY_SQL} from 1 for 1)) || substring(${PERIOD_KEY_SQL} from 2)
  END
`;
export const PERIOD_SORT_SQL = `
  CASE ${PERIOD_KEY_SQL}
    WHEN 'de madrugada' THEN 1
    WHEN 'pela manha' THEN 2
    WHEN 'a tarde' THEN 3
    WHEN 'a noite' THEN 4
    WHEN 'em hora incerta' THEN 5
    ELSE 99
  END
`;

const OCCURRENCE_HOUR_SQL = `hora_ocorrencia`;
const TOP_CHART_BUCKET_LIMIT = 12;
const RECORD_QUANTITY_SQL = `
  CASE
    WHEN record.value->>'quantidade' ~ '^[0-9]+$'
    THEN (record.value->>'quantidade')::int
    ELSE 1
  END
`;
const DRUG_GRAMS_SQL = `
  CASE
    WHEN record.value->>'quantidade_gramas' ~ '^[0-9]+([.,][0-9]+)?$'
    THEN replace(record.value->>'quantidade_gramas', ',', '.')::numeric
    ELSE 0
  END
`;

type SqlParam = string | number;

type SqlFilterOptions = {
  includeCategories?: boolean;
  includePeriods?: boolean;
  includeBounds?: boolean;
  includeHours?: boolean;
};

type MapFeaturesBoundsFilter = MapFeaturesFilterParams &
  Required<
    Pick<MapFeaturesFilterParams, 'minLon' | 'minLat' | 'maxLon' | 'maxLat'>
  >;

export function buildChartsQuery(whereClause: string): string {
  const chartJson = (selectSql: string, orderSql = 'count DESC, label ASC') => `
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'label', label,
          'count', count,
          'amount', amount
        )
        ORDER BY ${orderSql}
      ),
      '[]'::jsonb
    )
    FROM (
      ${selectSql}
    ) chart_rows
  `;

  const topChartJson = (selectSql: string) =>
    chartJson(`
      SELECT *
      FROM (
        ${selectSql}
      ) chart_data
      WHERE label IS NOT NULL
      ORDER BY count DESC, label ASC
      LIMIT ${TOP_CHART_BUCKET_LIMIT}
    `);

  return `
    WITH visible_features AS MATERIALIZED (
      SELECT
        category,
        all_rubricas,
        periodo_normalized,
        data_ocorrencia,
        total_records,
        delegacia,
        feature_data->'records' AS records,
        feature_data->'location'->>'tipo_local' AS location_type,
        feature_data->'occurrence'->>'delegacia_circunscricao' AS police_circumscription
      FROM map_features
      WHERE ${whereClause}
    ),
    visible_records AS MATERIALIZED (
      SELECT record.value
      FROM visible_features
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(records, '[]'::jsonb)
      ) record(value)
    )
    SELECT
      (SELECT COUNT(*) FROM visible_features) as total_features,
      (SELECT COALESCE(SUM(total_records), 0) FROM visible_features) as total_records,
      (${chartJson(`
        SELECT category_bucket.category_name as label, COUNT(*) as count, NULL::numeric as amount
        FROM visible_features
        ${buildCategoryBucketLateralSql('visible_features')}
        GROUP BY category_bucket.category_name
        ORDER BY count DESC, label ASC
        LIMIT ${TOP_CHART_BUCKET_LIMIT}
      `)}) as category_distribution,
      (${chartJson(
        `
          SELECT
            COALESCE(${PERIOD_LABEL_SQL}, 'Não informado') as label,
            COUNT(*) as count,
            NULL::numeric as amount,
            ${PERIOD_SORT_SQL} as sort_order
          FROM visible_features
          GROUP BY ${PERIOD_KEY_SQL}, ${PERIOD_LABEL_SQL}, ${PERIOD_SORT_SQL}
          ORDER BY sort_order ASC, label ASC
          LIMIT ${TOP_CHART_BUCKET_LIMIT}
        `,
        'sort_order ASC, label ASC'
      )}) as period_distribution,
      (${chartJson(
        `
          SELECT
            CASE EXTRACT(ISODOW FROM data_ocorrencia)::int
              WHEN 1 THEN 'Segunda'
              WHEN 2 THEN 'Terça'
              WHEN 3 THEN 'Quarta'
              WHEN 4 THEN 'Quinta'
              WHEN 5 THEN 'Sexta'
              WHEN 6 THEN 'Sábado'
              WHEN 7 THEN 'Domingo'
              ELSE 'Não informado'
            END as label,
            COUNT(*) as count,
            NULL::numeric as amount,
            COALESCE(EXTRACT(ISODOW FROM data_ocorrencia)::int, 8) as sort_order
          FROM visible_features
          GROUP BY label, sort_order
          ORDER BY sort_order ASC
        `,
        'sort_order ASC, label ASC'
      )}) as weekday_distribution,
      (${topChartJson(`
        SELECT
          CASE record.value->>'type'
            WHEN 'celular' THEN 'Celulares'
            WHEN 'veiculo' THEN 'Veículos'
            WHEN 'objeto' THEN 'Objetos'
            WHEN 'dados_criminais' THEN 'Dados criminais'
            WHEN 'produtividade_armas' THEN 'Armas'
            WHEN 'produtividade_entorpecentes' THEN 'Entorpecentes'
            WHEN 'produtividade_veiculos' THEN 'Veículos recuperados'
            WHEN 'produtividade_pessoa' THEN 'Pessoas'
            ELSE COALESCE(NULLIF(record.value->>'type', ''), 'Não informado')
          END as label,
          COUNT(*) as count,
          NULL::numeric as amount
        FROM visible_records record
        GROUP BY label
      `)}) as record_type_distribution,
      (${topChartJson(`
        SELECT
          COALESCE(
            NULLIF(record.value->>'descr_tipo_objeto', ''),
            NULLIF(record.value->>'descr_subtipo_objeto', ''),
            'Não informado'
          ) as label,
          COUNT(*) as count,
          SUM(${RECORD_QUANTITY_SQL}) as amount
        FROM visible_records record
        WHERE record.value->>'type' IN ('objeto', 'celular')
        GROUP BY label
      `)}) as object_type_distribution,
      (${topChartJson(`
        SELECT
          concat_ws(
            ' · ',
            COALESCE(NULLIF(record.value->>'marca', ''), 'Marca não informada'),
            NULLIF(record.value->>'tipo_veiculo', ''),
            NULLIF(record.value->>'ano_modelo', '')
          ) as label,
          COUNT(*) as count,
          NULL::numeric as amount
        FROM visible_records record
        WHERE record.value->>'type' IN ('veiculo', 'produtividade_veiculos')
        GROUP BY label
      `)}) as vehicle_brand_distribution,
      (${topChartJson(`
        SELECT
          concat_ws(
            ' · ',
            COALESCE(NULLIF(record.value->>'marca', ''), 'Marca não informada'),
            NULLIF(record.value->>'descr_subtipo_objeto', '')
          ) as label,
          COUNT(*) as count,
          SUM(${RECORD_QUANTITY_SQL}) as amount
        FROM visible_records record
        WHERE record.value->>'type' = 'celular'
        GROUP BY label
      `)}) as phone_brand_distribution,
      (${topChartJson(`
        SELECT
          COALESCE(
            NULLIF(location_type, ''),
            'Não informado'
          ) as label,
          COUNT(*) as count,
          NULL::numeric as amount
        FROM visible_features
        GROUP BY label
      `)}) as location_type_distribution,
      (${topChartJson(`
        SELECT
          COALESCE(
            NULLIF(police_circumscription, ''),
            'Não informado'
          ) as label,
          COUNT(*) as count,
          NULL::numeric as amount
        FROM visible_features
        GROUP BY label
      `)}) as police_circumscription_distribution,
      (${topChartJson(`
        SELECT
          COALESCE(NULLIF(delegacia, ''), 'Não informado') as label,
          COUNT(*) as count,
          NULL::numeric as amount
        FROM visible_features
        GROUP BY label
      `)}) as police_unit_distribution,
      (${topChartJson(`
        SELECT
          COALESCE(
            NULLIF(record.value->>'tipo_arma', ''),
            NULLIF(record.value->>'calibre', ''),
            'Não informado'
          ) as label,
          COUNT(*) as count,
          NULL::numeric as amount
        FROM visible_records record
        WHERE record.value->>'type' = 'produtividade_armas'
        GROUP BY label
      `)}) as weapon_type_distribution,
      (${topChartJson(`
        SELECT
          COALESCE(NULLIF(record.value->>'tipo_droga', ''), 'Não informado') as label,
          COUNT(*) as count,
          SUM(${DRUG_GRAMS_SQL}) as amount
        FROM visible_records record
        WHERE record.value->>'type' = 'produtividade_entorpecentes'
        GROUP BY label
      `)}) as drug_type_distribution
  `;
}

export function buildCategoryBucketLateralSql(sourceAlias: string): string {
  return `
    CROSS JOIN LATERAL (
      SELECT DISTINCT category_name
      FROM (
        SELECT NULLIF(btrim(rubrica.value), '') AS category_name
        FROM unnest(${sourceAlias}.all_rubricas) AS rubrica(value)
        UNION ALL
        SELECT NULLIF(btrim(${sourceAlias}.category), '')
      ) category_names
      WHERE category_name IS NOT NULL
    ) AS category_bucket
  `;
}

export function buildDateWhere(params?: {
  beforeDate?: string;
  afterDate?: string;
}): Prisma.MapFeatureWhereInput {
  const where: Prisma.MapFeatureWhereInput = {};

  if (params?.beforeDate || params?.afterDate) {
    where.data_ocorrencia = {};

    if (params.beforeDate) {
      where.data_ocorrencia.lte = params.beforeDate;
    }

    if (params.afterDate) {
      where.data_ocorrencia.gte = params.afterDate;
    }
  }

  return where;
}

export function appendSqlFilters(
  conditions: string[],
  queryParams: SqlParam[],
  initialParamIndex: number,
  params?: MapFeaturesFilterParams,
  options: SqlFilterOptions = {}
): number {
  const includeCategories = options.includeCategories ?? true;
  const includePeriods = options.includePeriods ?? true;
  const includeBounds = options.includeBounds ?? true;
  const includeHours = options.includeHours ?? true;
  let paramIndex = initialParamIndex;

  if (params?.beforeDate) {
    conditions.push(`data_ocorrencia <= $${paramIndex++}`);
    queryParams.push(params.beforeDate);
  }

  if (params?.afterDate) {
    conditions.push(`data_ocorrencia >= $${paramIndex++}`);
    queryParams.push(params.afterDate);
  }

  const categories = normalizeStringList(params?.categories);
  if (includeCategories && categories?.length) {
    const categoryPlaceholders = categories
      .map(() => `$${paramIndex++}`)
      .join(', ');
    conditions.push(
      `search_categories && ARRAY[${categoryPlaceholders}]::text[]`
    );
    queryParams.push(...categories);
  }

  if (includePeriods && params?.periods?.length) {
    const placeholders = params.periods
      .map(() => `$${paramIndex++}`)
      .join(', ');
    conditions.push(`${PERIOD_KEY_SQL} IN (${placeholders})`);
    queryParams.push(
      ...params.periods.map((period) => normalizePeriodKey(period))
    );
  }

  if (includeHours) {
    paramIndex = appendHourFilter(
      conditions,
      queryParams,
      paramIndex,
      params
    );
  }

  if (includeBounds && hasBounds(params)) {
    conditions.push(
      `geom && ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${
        paramIndex + 2
      }, $${paramIndex + 3}, 4326)`
    );
    queryParams.push(
      params.minLon,
      params.minLat,
      params.maxLon,
      params.maxLat
    );
    paramIndex += 4;
  }

  return paramIndex;
}

export function normalizePeriodKey(period: string): string {
  return period
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c');
}

export function normalizeImlLookupValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function buildBoWhere(
  numBo: string,
  anoBo?: number,
  delegacia?: string
): Prisma.MapFeatureWhereInput {
  const where: Prisma.MapFeatureWhereInput = { num_bo: numBo };

  if (anoBo !== undefined) {
    where.ano_bo = anoBo;
  }

  if (delegacia !== undefined) {
    where.delegacia = delegacia;
  }

  return where;
}

function appendHourFilter(
  conditions: string[],
  queryParams: SqlParam[],
  initialParamIndex: number,
  params?: Pick<MapFeaturesFilterParams, 'startHour' | 'endHour'>
): number {
  let paramIndex = initialParamIndex;
  const startHour = params?.startHour;
  const endHour = params?.endHour;

  if (startHour === undefined && endHour === undefined) {
    return paramIndex;
  }

  if (startHour !== undefined && endHour !== undefined) {
    if (startHour <= endHour) {
      conditions.push(
        `${OCCURRENCE_HOUR_SQL} BETWEEN $${paramIndex} AND $${
          paramIndex + 1
        }`
      );
    } else {
      conditions.push(
        `(${OCCURRENCE_HOUR_SQL} >= $${paramIndex} OR ${OCCURRENCE_HOUR_SQL} <= $${
          paramIndex + 1
        })`
      );
    }

    queryParams.push(startHour, endHour);
    return paramIndex + 2;
  }

  if (startHour !== undefined) {
    conditions.push(`${OCCURRENCE_HOUR_SQL} >= $${paramIndex++}`);
    queryParams.push(startHour);
  }

  if (endHour !== undefined) {
    conditions.push(`${OCCURRENCE_HOUR_SQL} <= $${paramIndex++}`);
    queryParams.push(endHour);
  }

  return paramIndex;
}

function hasBounds(
  params?: MapFeaturesFilterParams
): params is MapFeaturesBoundsFilter {
  return (
    params?.minLon !== undefined &&
    params.minLat !== undefined &&
    params.maxLon !== undefined &&
    params.maxLat !== undefined
  );
}
