import * as crypto from 'crypto';

import {
  LOCATION_COLUMN_MAPPINGS,
  OCCURRENCE_COLUMN_MAPPINGS,
  getSourceTableConfig,
} from '../../config/source-tables.config';
import { MIN_OCCURRENCE_DATE } from '../../config/date-range.config';
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

export interface EtlAggregationQuality {
  acceptedRows: number;
  missingIdentityRows: number;
  invalidCoordinateRows: number;
  outsideSupportedAreaRows: number;
}

export function createEtlAggregationQuality(): EtlAggregationQuality {
  return {
    acceptedRows: 0,
    missingIdentityRows: 0,
    invalidCoordinateRows: 0,
    outsideSupportedAreaRows: 0,
  };
}

export class MapFeaturesEtlAggregator {
  aggregateRows(
    rows: Record<string, unknown>[],
    tableName: string,
    config: SourceTableConfig,
    columnSet: Set<string>,
    features = new Map<string, AggregatedFeature>(),
    quality = createEtlAggregationQuality()
  ): Map<string, AggregatedFeature> {
    for (const row of rows) {
      const lat = this.parseCoordinate(row[config.columnMappings.latitude]);
      const lon = this.parseCoordinate(row[config.columnMappings.longitude]);

      if (lat === null || lon === null) {
        quality.invalidCoordinateRows++;
        continue;
      }
      if (lat < -25 || lat > -19 || lon < -54 || lon > -44) {
        quality.outsideSupportedAreaRows++;
        continue;
      }

      const numBo = String(row.__etl_sort_num_bo ?? '').trim();
      const anoBo = parseSourceInteger(row[config.columnMappings.ano_bo]);
      const delegaciaText = String(row.__etl_sort_delegacia ?? '').trim();
      const delegacia = delegaciaText || null;

      if (!numBo || anoBo === null) {
        quality.missingIdentityRows++;
        continue;
      }

      const canonicalLat = Number(row.__etl_sort_latitude_bucket);
      const canonicalLon = Number(row.__etl_sort_longitude_bucket);
      if (!Number.isFinite(canonicalLat) || !Number.isFinite(canonicalLon)) {
        throw new Error('ETL source row is missing canonical coordinate buckets');
      }
      const locationHash = this.createLocationHash(canonicalLat, canonicalLon);
      const key = this.getCanonicalGroupKey(row);

      let feature = features.get(key);
      if (!feature) {
        feature = this.createBaseFeature(
          numBo,
          anoBo,
          delegacia,
          canonicalLat,
          canonicalLon,
          locationHash,
          row,
          config,
          columnSet
        );
        features.set(key, feature);
      }

      this.reconcileCanonicalFields(feature, row, config, columnSet);
      this.addRecordToFeature(feature, row, tableName, config);
      quality.acceptedRows++;
    }

    return features;
  }

  getSourceTableCursor(row: Record<string, unknown>): SourceTableCursor {
    const id = parseSourceInteger(row.id);
    if (id === null || id < 1) {
      throw new Error('ETL source row is missing a valid positive id');
    }

    return {
      numBo: String(row.__etl_sort_num_bo),
      anoBo: String(row.__etl_sort_ano_bo),
      delegacia: String(row.__etl_sort_delegacia),
      latitudeBucket: String(row.__etl_sort_latitude_bucket),
      longitudeBucket: String(row.__etl_sort_longitude_bucket),
      id,
    };
  }

  private getCanonicalGroupKey(row: Record<string, unknown>): string {
    return [
      row.__etl_sort_num_bo,
      row.__etl_sort_ano_bo,
      row.__etl_sort_delegacia,
      row.__etl_sort_latitude_bucket,
      row.__etl_sort_longitude_bucket,
    ]
      .map((value) => String(value ?? '').trim())
      .join('|');
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

    if (!date || date < MIN_OCCURRENCE_DATE) {
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

  private reconcileCanonicalFields(
    feature: AggregatedFeature,
    row: Record<string, unknown>,
    config: SourceTableConfig,
    columnSet: Set<string>
  ): void {
    const candidateDate = config.columnMappings.data_ocorrencia
      ? this.parseOccurrenceDate(row[config.columnMappings.data_ocorrencia])
      : null;
    if (
      candidateDate &&
      (!feature.data_ocorrencia || candidateDate < feature.data_ocorrencia)
    ) {
      feature.data_ocorrencia = candidateDate;
    }

    const candidateCategory = config.columnMappings.rubrica
      ? String(row[config.columnMappings.rubrica] ?? '').trim()
      : config.derivedCategory ?? '';
    if (candidateCategory && candidateCategory < feature.category) {
      feature.category = candidateCategory;
      feature.rubrica_for_styling = config.columnMappings.rubrica
        ? candidateCategory
        : config.stylingRubrica ?? candidateCategory;
    }

    this.mergeDeterministically(
      feature.feature_data.location,
      this.extractLocationData(row, columnSet)
    );
    this.mergeDeterministically(
      feature.feature_data.occurrence,
      this.extractOccurrenceMetadata(row, columnSet)
    );
  }

  private mergeDeterministically<T extends object>(
    target: T,
    candidate: T
  ): void {
    const targetRecord = target as Record<string, unknown>;
    for (const [key, value] of Object.entries(candidate)) {
      const current = targetRecord[key];
      if (
        current === undefined ||
        String(value).localeCompare(String(current), 'pt-BR') < 0
      ) {
        targetRecord[key] = value;
      }
    }
  }

  private parseCoordinate(value: unknown): number | null {
    return parseSourceNumber(value);
  }

  private createLocationHash(lat: number, lon: number): string {
    const roundedLat = lat;
    const roundedLon = lon;
    const input = `${roundedLat.toFixed(6)}|${roundedLon.toFixed(6)}`;
    return crypto
      .createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 24);
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
