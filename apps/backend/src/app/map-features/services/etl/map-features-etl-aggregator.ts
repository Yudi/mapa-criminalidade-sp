import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';

import {
  LOCATION_COLUMN_MAPPINGS,
  OCCURRENCE_COLUMN_MAPPINGS,
  getSourceTableConfig,
} from '../../config/source-tables.config';
import {
  MIN_OCCURRENCE_DATE,
  MIN_OCCURRENCE_DATE_ISO,
} from '../../config/date-range.config';
import {
  LocationData,
  MapFeatureData,
  OccurrenceMetadata,
} from '../../types/map-features.types';
import {
  formatSourceDateOnly,
  parseSourceBooleanFlag,
  parseSourceDate,
  parseSourceInteger,
  parseSourceNumber,
} from '../../utils/source-value.utils';

type SourceTableConfig = NonNullable<ReturnType<typeof getSourceTableConfig>>;

export interface AggregatedFeature {
  num_bo: string;
  ano_bo: number;
  delegacia: string | null;
  latitude: number;
  longitude: number;
  location_hash: string;
  category: string;
  rubrica_for_styling: string;
  data_ocorrencia: Date | null;
  source_tables: string[];
  feature_data: MapFeatureData;
}

export interface SourceTableCursor {
  numBo: string;
  anoBo: string;
  delegacia: string;
  latitudeBucket: string;
  longitudeBucket: string;
  id: number;
}

export class MapFeaturesEtlAggregator {
  constructor(private readonly logger: Logger) {}

  aggregateRows(
    rows: Record<string, unknown>[],
    tableName: string,
    config: SourceTableConfig,
    columnSet: Set<string>,
    features = new Map<string, AggregatedFeature>()
  ): Map<string, AggregatedFeature> {
    if (rows.length > 0 && config.columnMappings.delegacia) {
      const firstRow = rows[0];
      const delegaciaCol = config.columnMappings.delegacia;
      this.logger.debug(
        `[DEBUG] Table: ${tableName}, Delegacia column: ${delegaciaCol}, Value: ${
          firstRow[delegaciaCol]
        }, Keys: ${Object.keys(firstRow)
          .filter((k) => k.toLowerCase().includes('deleg'))
          .join(', ')}`
      );
    }

    for (const row of rows) {
      const lat = this.parseCoordinate(row[config.columnMappings.latitude]);
      const lon = this.parseCoordinate(row[config.columnMappings.longitude]);

      if (lat === null || lon === null) continue;
      if (lat < -25 || lat > -19 || lon < -54 || lon > -44) continue;

      const numBo = String(row[config.columnMappings.num_bo]);
      const anoBo = parseSourceInteger(row[config.columnMappings.ano_bo]);
      const delegacia = row[config.columnMappings.delegacia]
        ? String(row[config.columnMappings.delegacia])
        : null;

      if (!numBo || anoBo === null) continue;

      const locationHash = this.createLocationHash(lat, lon);
      const delegaciaKey = delegacia || '';
      const key = `${numBo}|${anoBo}|${delegaciaKey}|${locationHash}`;

      let feature = features.get(key);
      if (!feature) {
        feature = this.createBaseFeature(
          numBo,
          anoBo,
          delegacia,
          lat,
          lon,
          locationHash,
          row,
          config,
          columnSet
        );
        features.set(key, feature);
      }

      this.addRecordToFeature(feature, row, tableName, config);
    }

    return features;
  }

  getSourceTableCursor(row: Record<string, unknown>): SourceTableCursor {
    return {
      numBo: String(row.__etl_sort_num_bo),
      anoBo: String(row.__etl_sort_ano_bo),
      delegacia: String(row.__etl_sort_delegacia),
      latitudeBucket: String(row.__etl_sort_latitude_bucket),
      longitudeBucket: String(row.__etl_sort_longitude_bucket),
      id: parseSourceInteger(row.id) ?? 0,
    };
  }

  splitFinalAggregatedFeature(features: Map<string, AggregatedFeature>): {
    completed: Map<string, AggregatedFeature>;
    nextCarryover: Map<string, AggregatedFeature>;
  } {
    if (features.size === 0) {
      return {
        completed: features,
        nextCarryover: new Map<string, AggregatedFeature>(),
      };
    }

    const entries = Array.from(features.entries());
    const [lastKey, lastFeature] = entries[entries.length - 1];
    const nextCarryover = new Map<string, AggregatedFeature>([
      [lastKey, lastFeature],
    ]);

    features.delete(lastKey);

    return {
      completed: features,
      nextCarryover,
    };
  }

  private createBaseFeature(
    numBo: string,
    anoBo: number,
    delegacia: string | null,
    lat: number,
    lon: number,
    locationHash: string,
    row: Record<string, unknown>,
    config: SourceTableConfig,
    columnSet: Set<string>
  ): AggregatedFeature {
    let dataOcorrencia: Date | null = null;
    if (config.columnMappings.data_ocorrencia) {
      const dateVal = row[config.columnMappings.data_ocorrencia];
      if (dateVal) {
        dataOcorrencia = this.parseOccurrenceDate(dateVal);
      }
    }

    let category: string;
    let rubricaForStyling: string;

    if (config.columnMappings.rubrica && row[config.columnMappings.rubrica]) {
      category = String(row[config.columnMappings.rubrica]);
      rubricaForStyling = category;
    } else if (config.derivedCategory) {
      category = config.derivedCategory;
      rubricaForStyling = config.stylingRubrica || category;
    } else {
      category = 'Outros';
      rubricaForStyling = 'default';
    }

    return {
      num_bo: numBo,
      ano_bo: anoBo,
      delegacia,
      latitude: lat,
      longitude: lon,
      location_hash: locationHash,
      category,
      rubrica_for_styling: rubricaForStyling,
      data_ocorrencia: dataOcorrencia,
      source_tables: [],
      feature_data: {
        location: this.extractLocationData(row, columnSet),
        occurrence: this.extractOccurrenceMetadata(row, columnSet),
        all_rubricas: [],
        records: [],
        summary: {
          total_records: 0,
          celulares_count: 0,
          veiculos_count: 0,
          objetos_count: 0,
          dados_criminais_count: 0,
          produtividade_count: 0,
        },
      },
    };
  }

  private parseOccurrenceDate(value: unknown): Date | null {
    const date = parseSourceDate(value);
    const text = String(value).trim();

    if (!date || date < MIN_OCCURRENCE_DATE) {
      this.logger.warn(
        `Ignoring occurrence date before ${MIN_OCCURRENCE_DATE_ISO}: "${text}"`
      );
      return null;
    }

    return date;
  }

  private addRecordToFeature(
    feature: AggregatedFeature,
    row: Record<string, unknown>,
    tableName: string,
    config: SourceTableConfig
  ): void {
    if (!feature.source_tables.includes(tableName)) {
      feature.source_tables.push(tableName);
    }

    const record = config.extractRecord(row, tableName);
    feature.feature_data.records.push(record);

    if (config.columnMappings.rubrica && row[config.columnMappings.rubrica]) {
      const rubrica = String(row[config.columnMappings.rubrica]);
      if (!feature.feature_data.all_rubricas.includes(rubrica)) {
        feature.feature_data.all_rubricas.push(rubrica);
      }
    }

    feature.feature_data.summary.total_records++;
    switch (record.type) {
      case 'celular':
        feature.feature_data.summary.celulares_count++;
        break;
      case 'veiculo':
        feature.feature_data.summary.veiculos_count++;
        break;
      case 'objeto':
        feature.feature_data.summary.objetos_count++;
        break;
      case 'dados_criminais':
        feature.feature_data.summary.dados_criminais_count++;
        break;
      default:
        feature.feature_data.summary.produtividade_count++;
    }
  }

  private parseCoordinate(value: unknown): number | null {
    return parseSourceNumber(value);
  }

  private createLocationHash(lat: number, lon: number): string {
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLon = Math.round(lon * 10000) / 10000;
    const input = `${roundedLat.toFixed(4)}|${roundedLon.toFixed(4)}`;
    return crypto
      .createHash('md5')
      .update(input)
      .digest('hex')
      .substring(0, 16);
  }

  private extractLocationData(
    row: Record<string, unknown>,
    columnSet: Set<string>
  ): LocationData {
    const location: LocationData = {};

    for (const [key, alts] of Object.entries(LOCATION_COLUMN_MAPPINGS)) {
      for (const col of alts) {
        if (columnSet.has(col.toUpperCase()) && row[col]) {
          location[key as keyof LocationData] = String(row[col]);
          break;
        }
      }
    }

    return location;
  }

  private extractOccurrenceMetadata(
    row: Record<string, unknown>,
    columnSet: Set<string>
  ): OccurrenceMetadata {
    const metadata: OccurrenceMetadata = {};

    for (const [key, alts] of Object.entries(OCCURRENCE_COLUMN_MAPPINGS)) {
      for (const col of alts) {
        if (columnSet.has(col.toUpperCase()) && row[col]) {
          if (key === 'flagrante') {
            metadata.flagrante = parseSourceBooleanFlag(row[col]);
          } else if (key.startsWith('data_')) {
            const date = formatSourceDateOnly(row[col]);
            if (date) {
              (metadata as Record<string, unknown>)[key] = date;
            }
          } else {
            (metadata as Record<string, unknown>)[key] = String(row[col]);
          }
          break;
        }
      }
    }

    return metadata;
  }
}
