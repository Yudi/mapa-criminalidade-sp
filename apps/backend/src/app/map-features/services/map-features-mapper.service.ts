import { Injectable } from '@nestjs/common';
import type {
  ImlRecord,
  LocationData,
  MapFeature,
  MapFeatureData,
  MapFeatureSummaryRecord,
  OccurrenceMetadata,
  SourceRecord,
} from '../types/map-features.types';
import {
  FeatureDataSummaryObject,
  GroupedOccurrenceObject,
  MapFeatureDataObject,
  MapFeatureDetailObject,
  MapFeatureSummaryObject,
  SourceRecordObject,
} from '../graphql/map-features.graphql';

@Injectable()
export class MapFeaturesMapperService {
  toSummary(
    feature: MapFeature | MapFeatureSummaryRecord
  ): MapFeatureSummaryObject {
    return {
      id: feature.id,
      numBo: feature.num_bo,
      anoBo: feature.ano_bo,
      delegacia: feature.delegacia,
      latitude: feature.latitude,
      longitude: feature.longitude,
      category: feature.category,
      rubricaForStyling: feature.rubrica_for_styling,
      dataOcorrencia: this.formatDateOnly(feature.data_ocorrencia),
      sourceTables: feature.source_tables,
    };
  }

  toDetail(
    feature: MapFeature,
    imlRecords: ImlRecord[] = []
  ): MapFeatureDetailObject {
    return {
      ...this.toSummary(feature),
      featureData: this.toFeatureData(feature.feature_data),
      imlRecords,
    };
  }

  toGroupedOccurrence(feature: MapFeature): GroupedOccurrenceObject {
    const featureData = this.normalizeFeatureData(feature.feature_data);
    const location = featureData.location;
    const occurrence = featureData.occurrence;

    const occurrences = featureData.records.map((record) => ({
      id: `${record.source_table}:${record.source_id}`,
      sourceTable: record.source_table,
      numBo: feature.num_bo,
      anoBo: feature.ano_bo,
      category: this.getRecordCategory(record, feature.category),
      rubricaForStyling: feature.rubrica_for_styling,
      latitude: feature.latitude,
      longitude: feature.longitude,
      dataOcorrencia: this.formatDateOnly(feature.data_ocorrencia),
      horaOcorrencia: occurrence.hora_ocorrencia ?? null,
      dataRegistro: occurrence.data_registro ?? null,
      logradouro: location.logradouro ?? null,
      numeroLogradouro: location.numero ?? null,
      bairro: location.bairro ?? null,
      cidade: location.cidade ?? null,
      localTipo: location.tipo_local ?? null,
      periodo: occurrence.periodo ?? null,
      conduta: occurrence.conduta ?? null,
      naturezaApurada: occurrence.natureza_apurada ?? null,
      delegacia: occurrence.delegacia ?? feature.delegacia ?? null,
    }));

    if (occurrences.length === 0) {
      occurrences.push({
        id: `map_features:${feature.id}`,
        sourceTable: feature.source_tables[0] ?? 'unknown',
        numBo: feature.num_bo,
        anoBo: feature.ano_bo,
        category: feature.category,
        rubricaForStyling: feature.rubrica_for_styling,
        latitude: feature.latitude,
        longitude: feature.longitude,
        dataOcorrencia: this.formatDateOnly(feature.data_ocorrencia),
        horaOcorrencia: occurrence.hora_ocorrencia ?? null,
        dataRegistro: occurrence.data_registro ?? null,
        logradouro: location.logradouro ?? null,
        numeroLogradouro: location.numero ?? null,
        bairro: location.bairro ?? null,
        cidade: location.cidade ?? null,
        localTipo: location.tipo_local ?? null,
        periodo: occurrence.periodo ?? null,
        conduta: occurrence.conduta ?? null,
        naturezaApurada: occurrence.natureza_apurada ?? null,
        delegacia: occurrence.delegacia ?? feature.delegacia ?? null,
      });
    }

    return {
      numBo: feature.num_bo,
      anoBo: feature.ano_bo,
      latitude: feature.latitude,
      longitude: feature.longitude,
      primaryCategory: feature.category,
      allCategories: featureData.all_rubricas.length
        ? featureData.all_rubricas
        : [feature.category],
      recordCount: featureData.summary.total_records || occurrences.length,
      sourceTables: feature.source_tables,
      occurrences,
    };
  }

  private toFeatureData(featureData: MapFeatureData): MapFeatureDataObject {
    const normalized = this.normalizeFeatureData(featureData);

    return {
      location: normalized.location,
      occurrence: normalized.occurrence,
      all_rubricas: normalized.all_rubricas,
      records: normalized.records.map((record) => this.toSourceRecord(record)),
      summary: normalized.summary,
    };
  }

  private normalizeFeatureData(featureData: MapFeatureData): {
    location: LocationData;
    occurrence: OccurrenceMetadata;
    all_rubricas: string[];
    records: SourceRecord[];
    summary: FeatureDataSummaryObject;
  } {
    const records = featureData.records ?? [];

    return {
      location: featureData.location ?? {},
      occurrence: featureData.occurrence ?? {},
      all_rubricas: featureData.all_rubricas ?? [],
      records,
      summary: {
        total_records: featureData.summary?.total_records ?? records.length,
        celulares_count: featureData.summary?.celulares_count ?? 0,
        veiculos_count: featureData.summary?.veiculos_count ?? 0,
        objetos_count: featureData.summary?.objetos_count ?? 0,
        dados_criminais_count:
          featureData.summary?.dados_criminais_count ?? 0,
        produtividade_count: featureData.summary?.produtividade_count ?? 0,
      },
    };
  }

  private toSourceRecord(record: SourceRecord): SourceRecordObject {
    return {
      ...record,
      source_id: record.source_id,
      source_table: record.source_table,
      type: record.type,
    };
  }

  private getRecordCategory(
    record: SourceRecord,
    fallbackCategory: string
  ): string {
    return 'rubrica' in record && record.rubrica
      ? record.rubrica
      : fallbackCategory;
  }

  private formatDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
  }
}
