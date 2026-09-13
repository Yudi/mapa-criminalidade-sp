import { GroupedOccurrence, FeatureDetail } from '../graphql-projections';
import { z } from 'zod';

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
});

const imlRecordSchema = z.object({
  sourceId: z.number(),
  sourceTable: z.string(),
  dataEntradaIml: nullableStringSchema,
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
    dataOcorrencia: nullableStringSchema,
    horaOcorrencia: nullableStringSchema,
    dataRegistro: nullableStringSchema,
    logradouro: nullableStringSchema,
    numeroLogradouro: nullableStringSchema,
    bairro: nullableStringSchema,
    cidade: nullableStringSchema,
    localTipo: nullableStringSchema,
    conduta: nullableStringSchema,
    naturezaApurada: nullableStringSchema,
  })
  .passthrough();

export const groupedOccurrenceSchema = z
  .object({
    numBo: z.string(),
    anoBo: z.number(),
    primaryCategory: z.string(),
    occurrences: z.array(unifiedOccurrenceSchema),
  })
  .passthrough();

export const mapFeatureResponseSchema = z
  .object({
    imlUnavailable: z.boolean().optional(),
    dataOcorrencia: nullableStringSchema,
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
): FeatureDetail | null {
  if (value === null || value === undefined) {
    return null;
  }

  return mapFeatureResponseSchema.parse(value) as FeatureDetail;
}
