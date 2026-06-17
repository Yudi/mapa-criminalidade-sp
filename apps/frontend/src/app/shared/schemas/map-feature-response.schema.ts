import { z } from 'zod';
import {
  GroupedOccurrence,
  MapFeatureResponse,
} from '@mapa-criminalidade/shared-types';

const nullableStringSchema = z.string().nullable();

const sourceRecordSchema = z
  .object({
    type: z.enum([
      'celular',
      'veiculo',
      'objeto',
      'dados_criminais',
      'produtividade_armas',
      'produtividade_entorpecentes',
      'produtividade_veiculos',
      'produtividade_pessoa',
    ]),
    source_id: z.number(),
    source_table: z.string(),
  })
  .passthrough();

const featureDataSchema = z.object({
  location: z.object({}).passthrough(),
  occurrence: z.object({}).passthrough(),
  all_rubricas: z.array(z.string()),
  records: z.array(sourceRecordSchema),
  summary: z
    .object({
      total_records: z.number(),
      celulares_count: z.number(),
      veiculos_count: z.number(),
      objetos_count: z.number(),
      dados_criminais_count: z.number(),
      produtividade_count: z.number(),
    })
    .passthrough(),
});

const imlRecordSchema = z.object({
  sourceId: z.number(),
  sourceTable: z.string(),
  dataEntradaIml: nullableStringSchema,
  anoBo: nullableStringSchema,
  numBo: nullableStringSchema,
  delegaciaRegistro: nullableStringSchema,
  numeroLaudo: nullableStringSchema,
  anoLaudo: nullableStringSchema,
  idadeVitima: nullableStringSchema,
  tipoIdade: nullableStringSchema,
  conclusao: nullableStringSchema,
  declaracaoObito: nullableStringSchema,
  causaMortis: nullableStringSchema,
});

const unifiedOccurrenceSchema = z
  .object({
    id: z.string(),
    sourceTable: z.string(),
    numBo: z.string(),
    anoBo: z.number().nullable(),
    category: z.string(),
    rubricaForStyling: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    dataOcorrencia: nullableStringSchema,
    horaOcorrencia: nullableStringSchema,
    dataRegistro: nullableStringSchema,
    logradouro: nullableStringSchema,
    numeroLogradouro: nullableStringSchema,
    bairro: nullableStringSchema,
    cidade: nullableStringSchema,
    localTipo: nullableStringSchema,
    periodo: nullableStringSchema,
    conduta: nullableStringSchema,
    naturezaApurada: nullableStringSchema,
    delegacia: nullableStringSchema,
  })
  .passthrough();

export const groupedOccurrenceSchema = z
  .object({
    numBo: z.string(),
    anoBo: z.number(),
    latitude: z.number(),
    longitude: z.number(),
    primaryCategory: z.string(),
    allCategories: z.array(z.string()),
    recordCount: z.number(),
    occurrences: z.array(unifiedOccurrenceSchema),
    sourceTables: z.array(z.string()),
  })
  .passthrough();

export const mapFeatureResponseSchema = z
  .object({
    id: z.string(),
    numBo: z.string(),
    anoBo: z.number(),
    delegacia: nullableStringSchema,
    latitude: z.number(),
    longitude: z.number(),
    category: z.string(),
    rubricaForStyling: z.string(),
    dataOcorrencia: nullableStringSchema,
    sourceTables: z.array(z.string()),
    featureData: featureDataSchema,
    imlRecords: z.array(imlRecordSchema),
  })
  .passthrough();

export function parseGroupedOccurrence(
  value: unknown
): GroupedOccurrence | null {
  if (value === null || value === undefined) {
    return null;
  }

  return groupedOccurrenceSchema.parse(value) as GroupedOccurrence;
}

export function parseMapFeatureResponse(
  value: unknown
): MapFeatureResponse | null {
  if (value === null || value === undefined) {
    return null;
  }

  return mapFeatureResponseSchema.parse(value) as MapFeatureResponse;
}
