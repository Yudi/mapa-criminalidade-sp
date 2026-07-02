import type { MapFeature as PrismaMapFeature } from '../../../../generated/prisma/client';
import {
  MapFeature,
  MapFeatureData,
  MapFeaturesCategoryStats,
  MapFeaturesPeriodStats,
  SourceRecord,
} from '../../types/map-features.types';

export type ChartBucketRow = {
  label: string | null;
  count: bigint | string | number;
  amount?: string | number | null;
};

export function mapPrismaFeature(row: PrismaMapFeature): MapFeature {
  return {
    id: row.id,
    num_bo: row.num_bo,
    ano_bo: row.ano_bo,
    delegacia: row.delegacia ?? null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    location_hash: row.location_hash,
    geom: null,
    category: row.category,
    rubrica_for_styling: row.rubrica_for_styling,
    data_ocorrencia: row.data_ocorrencia,
    source_tables: row.source_tables,
    feature_data: row.feature_data as unknown as MapFeatureData,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function normalizeFeatureData(
  featureData: MapFeatureData
): MapFeatureData {
  const records = featureData.records ?? [];

  return {
    location: featureData.location ?? {},
    occurrence: featureData.occurrence ?? {},
    all_rubricas: featureData.all_rubricas ?? [],
    records,
    summary: featureData.summary ?? summarizeFeatureRecords(records),
  };
}

export function getAllRubricas(
  existingRubricas: string[],
  records: SourceRecord[]
): string[] {
  const rubricas = new Set(existingRubricas);

  records.forEach((record) => {
    if ('rubrica' in record && record.rubrica) {
      rubricas.add(record.rubrica);
    }
  });

  return [...rubricas];
}

export function summarizeFeatureRecords(
  records: SourceRecord[]
): MapFeatureData['summary'] {
  return {
    total_records: records.length,
    celulares_count: records.filter((record) => record.type === 'celular')
      .length,
    veiculos_count: records.filter((record) => record.type === 'veiculo')
      .length,
    objetos_count: records.filter((record) => record.type === 'objeto').length,
    dados_criminais_count: records.filter(
      (record) => record.type === 'dados_criminais'
    ).length,
    produtividade_count: records.filter((record) =>
      [
        'produtividade_armas',
        'produtividade_entorpecentes',
        'produtividade_veiculos',
        'produtividade_pessoa',
      ].includes(record.type)
    ).length,
  };
}

export function toChartBuckets(rows: ChartBucketRow[]) {
  return rows.map((row) => ({
    label: row.label?.trim() || 'Não informado',
    count: Number(row.count),
    amount:
      row.amount === undefined || row.amount === null
        ? null
        : Number(row.amount),
  }));
}

export function toChartBucketsFromJson(value: unknown) {
  return toChartBuckets(parseJsonArray(value) as ChartBucketRow[]);
}

export function toCategoryStatsFromJson(
  value: unknown
): MapFeaturesCategoryStats[] {
  return parseJsonArray(value)
    .map((item) => {
      const row = item as {
        category?: unknown;
        count?: unknown;
        rubrica_for_styling?: unknown;
        is_rubrica?: unknown;
      };
      const category = String(row.category ?? '').trim();

      return {
        name: category,
        count: Number(row.count ?? 0),
        rubricaForStyling: String(row.rubrica_for_styling ?? category),
        sourceType: row.is_rubrica ? ('rubrica' as const) : ('derived' as const),
      };
    })
    .filter((category) => category.name.length > 0);
}

export function toPeriodStatsFromJson(
  value: unknown
): MapFeaturesPeriodStats[] {
  return parseJsonArray(value).map((item) => {
    const row = item as { name?: unknown; count?: unknown };
    return {
      name: String(row.name ?? ''),
      count: Number(row.count ?? 0),
    };
  });
}

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function formatDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
