import { PrismaService } from '../../../prisma/prisma.service';
import { qualifiedTableName } from '../../../prisma/sql.utils';
import { getSourceTableConfig } from '../../config/source-tables.config';
import {
  MapFeature,
  SourceRecord,
} from '../../types/map-features.types';
import {
  sourceIntegerExpression,
  sourceNumberExpression,
  sourceTextColumnExpression,
  sourceTextExpression,
} from '../../utils/source-sql.utils';
import {
  getAllRubricas,
  normalizeFeatureData,
  summarizeFeatureRecords,
} from './map-features-result-mappers';

export class MapFeaturesSourceRecordHydrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enabled: boolean
  ) {}

  async hydrate(feature: MapFeature): Promise<MapFeature> {
    if (!this.enabled) {
      return feature;
    }

    const featureData = normalizeFeatureData(feature.feature_data);
    const existingSourceTables = new Set(
      featureData.records.map((record) => record.source_table)
    );
    const missingSourceTables = feature.source_tables.filter(
      (sourceTable) => !existingSourceTables.has(sourceTable)
    );

    if (missingSourceTables.length === 0) {
      return feature;
    }

    const hydratedRecords: SourceRecord[] = [];

    for (const sourceTable of missingSourceTables) {
      const records = await this.getRawSourceRecords(feature, sourceTable);
      hydratedRecords.push(...records);
    }

    if (hydratedRecords.length === 0) {
      return feature;
    }

    const records = [...featureData.records, ...hydratedRecords];

    return {
      ...feature,
      feature_data: {
        ...featureData,
        all_rubricas: getAllRubricas(featureData.all_rubricas, records),
        records,
        summary: summarizeFeatureRecords(records),
      },
    };
  }

  private async getRawSourceRecords(
    feature: MapFeature,
    sourceTable: string
  ): Promise<SourceRecord[]> {
    const config = getSourceTableConfig(sourceTable);

    if (!config) {
      return [];
    }

    const query = `
      SELECT *
      FROM ${qualifiedTableName(sourceTable)}
      WHERE NULLIF(btrim(${sourceTextColumnExpression(
        config.columnMappings.num_bo
      )}), '') = $1
        AND ${sourceIntegerExpression(config.columnMappings.ano_bo)} = $2
        AND ${sourceTextExpression(config.columnMappings.delegacia)} = $3
        AND ROUND(${sourceNumberExpression(
          config.columnMappings.latitude
        )}, 4) = ROUND($4::numeric, 4)
        AND ROUND(${sourceNumberExpression(
          config.columnMappings.longitude
        )}, 4) = ROUND($5::numeric, 4)
      ORDER BY id
    `;

    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      query,
      feature.num_bo,
      feature.ano_bo,
      feature.delegacia ?? '',
      feature.latitude,
      feature.longitude
    );

    return rows.map((row) => config.extractRecord(row, sourceTable));
  }
}
