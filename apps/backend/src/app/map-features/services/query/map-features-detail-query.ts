import { PrismaService } from '../../../prisma/prisma.service';
import {
  MapFeature,
  MapFeatureSummaryRecord,
} from '../../types/map-features.types';
import {
  mapPrismaFeature,
} from './map-features-result-mappers';
import { buildBoWhere } from './map-features-query-sql';
import { MapFeaturesSourceRecordHydrator } from './map-features-source-record-hydrator';

export const MAX_DETAIL_RESULTS = 500;
export const MAX_DETAIL_HYDRATION_CONCURRENCY = 8;

export class AmbiguousMapFeatureLookupError extends Error {
  readonly code = 'MAP_FEATURE_LOOKUP_AMBIGUOUS';

  constructor() {
    super(
      'More than one occurrence matches this BO. Supply the year and registration police unit.'
    );
    this.name = 'AmbiguousMapFeatureLookupError';
  }
}

export class MapFeaturesDetailQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceHydrator: MapFeaturesSourceRecordHydrator
  ) {}

  /** Uses the registration police unit to disambiguate pre-2022 BO numbers. */
  async getFeaturesByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string
  ): Promise<MapFeature[]> {
    const where = buildBoWhere(numBo, anoBo, delegacia);

    const results = await this.prisma.mapFeature.findMany({
      where,
      orderBy: [{ data_ocorrencia: 'desc' }, { id: 'asc' }],
      take: MAX_DETAIL_RESULTS,
    });

    return await mapWithConcurrency(
      results,
      MAX_DETAIL_HYDRATION_CONCURRENCY,
      (row) => this.sourceHydrator.hydrate(mapPrismaFeature(row))
    );
  }

  async getFeatureSummariesByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string | null
  ): Promise<MapFeatureSummaryRecord[]> {
    const where = buildBoWhere(numBo, anoBo, delegacia ?? undefined);

    const results = await this.prisma.mapFeature.findMany({
      where,
      orderBy: [{ data_ocorrencia: 'desc' }, { id: 'asc' }],
      take: MAX_DETAIL_RESULTS,
      select: {
        id: true,
        num_bo: true,
        ano_bo: true,
        delegacia: true,
        latitude: true,
        longitude: true,
        category: true,
        rubrica_for_styling: true,
        data_ocorrencia: true,
        source_tables: true,
      },
    });

    return results.map((row) => ({
      id: row.id,
      num_bo: row.num_bo,
      ano_bo: row.ano_bo,
      delegacia: row.delegacia ?? null,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      category: row.category,
      rubrica_for_styling: row.rubrica_for_styling,
      data_ocorrencia: row.data_ocorrencia,
      source_tables: row.source_tables,
    }));
  }

  async getFeatureByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string | null
  ): Promise<MapFeature | null> {
    const results = await this.prisma.mapFeature.findMany({
      where: buildBoWhere(numBo, anoBo, delegacia ?? undefined),
      orderBy: [{ data_ocorrencia: 'desc' }, { id: 'asc' }],
      take: 2,
    });

    if (results.length > 1) {
      throw new AmbiguousMapFeatureLookupError();
    }

    const [feature] = results;
    return feature
      ? await this.sourceHydrator.hydrate(mapPrismaFeature(feature))
      : null;
  }

  async getFeatureById(id: string): Promise<MapFeature | null> {
    const row = await this.prisma.mapFeature.findUnique({
      where: { id },
    });

    return row ? await this.sourceHydrator.hydrate(mapPrismaFeature(row)) : null;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker()
    )
  );
  return results;
}
