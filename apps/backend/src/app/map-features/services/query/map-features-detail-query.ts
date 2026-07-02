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
      orderBy: { data_ocorrencia: 'desc' },
    });

    return await Promise.all(
      results.map((row) => this.sourceHydrator.hydrate(mapPrismaFeature(row)))
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
      orderBy: { data_ocorrencia: 'desc' },
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
    const [feature] = await this.getFeaturesByBo(
      numBo,
      anoBo,
      delegacia ?? undefined
    );
    return feature ?? null;
  }

  async getFeatureById(id: string): Promise<MapFeature | null> {
    const row = await this.prisma.mapFeature.findUnique({
      where: { id },
    });

    return row ? await this.sourceHydrator.hydrate(mapPrismaFeature(row)) : null;
  }
}
