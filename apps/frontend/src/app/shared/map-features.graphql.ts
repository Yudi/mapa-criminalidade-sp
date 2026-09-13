const CATEGORY_FIELDS = `
  name
  count
  rubricaForStyling
`;

const PERIOD_FIELDS = `
  name
  count
`;

const CHART_BUCKET_FIELDS = `
  label
  count
`;

const GROUPED_OCCURRENCE_FIELDS = `
  numBo
  anoBo
  primaryCategory
  occurrences {
    dataOcorrencia
    horaOcorrencia
    dataRegistro
    logradouro
    numeroLogradouro
    bairro
    cidade
    localTipo
    conduta
    naturezaApurada
  }
`;

const FEATURE_DETAIL_FIELDS = `
  imlUnavailable
  dataOcorrencia
  featureData {
    location {
      logradouro
      numero
      bairro
      cidade
      tipo_local
    }
    occurrence {
      hora_ocorrencia
      delegacia
      delegacia_circunscricao
      natureza_apurada
    }
    all_rubricas
    records {
      type
      source_id
      source_table
      rubrica
      descr_modo_objeto
      descr_tipo_objeto
      descr_subtipo_objeto
      descr_ocorrencia
      descricao_apresentacao
      marca
      quantidade
      bloqueio
      tipo_veiculo
      cor
      placa
      ano_fabricacao
      ano_modelo
      natureza_apurada
      tipo_arma
      calibre
      tipo_droga
      quantidade_gramas
      tipo_pessoa
      sexo
      idade
      profissao
      grau_instrucao
      nacionalidade
    }
  }
  imlRecords {
    sourceId
    sourceTable
    dataEntradaIml
    delegaciaRegistro
    numeroLaudo
    anoLaudo
    idadeVitima
    tipoIdade
    conclusao
    declaracaoObito
    causaMortis
  }
`;

export const MAP_FEATURES_METADATA_QUERY = `
  query MapFeaturesMetadata {
    mapFeaturesMetadata {
      datasetRevision
      dateRange {
        earliest
        latest
        defaultAfter
      }
    }
  }
`;

export const MAP_FEATURES_DATE_RANGE_QUERY = `
  query MapFeaturesDateRange {
    mapFeaturesDateRange {
      earliest
      latest
      defaultAfter
    }
  }
`;

export const MAP_FEATURES_CATEGORIES_FOR_LOCATION_QUERY = `
  query MapFeaturesCategoriesForLocation($input: MapFeatureLocationInput!) {
    mapFeaturesCategoriesForLocation(input: $input) {
      ${CATEGORY_FIELDS}
    }
  }
`;

export const MAP_FEATURES_CATEGORY_PERIOD_STATS_QUERY = `
  query MapFeaturesCategoryPeriodStats($filter: MapFeatureFilterInput) {
    mapFeaturesCategoryPeriodStats(filter: $filter) {
      categories {
        ${CATEGORY_FIELDS}
      }
      periods {
        ${PERIOD_FIELDS}
      }
    }
  }
`;

export const MAP_FEATURES_CHARTS_QUERY = `
  query MapFeaturesCharts($filter: MapFeatureFilterInput) {
    mapFeaturesCharts(filter: $filter) {
      totalFeatures
      totalRecords
      categoryDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      periodDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      weekdayDistribution {
        filterValue
        ${CHART_BUCKET_FIELDS}
      }
      weekdayHourDistribution {
        weekday
        hour
        count
      }
      recordTypeDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      objectTypeDistribution {
        amount
        filterValue
        ${CHART_BUCKET_FIELDS}
      }
      vehicleBrandDistribution {
        filterValue
        ${CHART_BUCKET_FIELDS}
      }
      phoneBrandDistribution {
        amount
        filterValue
        ${CHART_BUCKET_FIELDS}
      }
      locationTypeDistribution {
        filterValue
        ${CHART_BUCKET_FIELDS}
      }
      policeCircumscriptionDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      policeUnitDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      weaponTypeDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      drugTypeDistribution {
        amount
        ${CHART_BUCKET_FIELDS}
      }
    }
  }
`;

export const GROUPED_OCCURRENCE_BY_BO_QUERY = `
  query GroupedOccurrenceByBo($input: MapFeatureLookupInput!) {
    groupedOccurrenceByBo(input: $input) {
      ${GROUPED_OCCURRENCE_FIELDS}
    }
  }
`;

export const MAP_FEATURE_BY_ID_QUERY = `
  query MapFeatureById($id: ID!) {
    mapFeatureById(id: $id) {
      ${FEATURE_DETAIL_FIELDS}
    }
  }
`;

const CHART_FACET_FIELDS = {
  categories: `categoryDistribution { ${CHART_BUCKET_FIELDS} }`,
  weekdays: `weekdayDistribution { filterValue ${CHART_BUCKET_FIELDS} }`,
  objectTypes: `objectTypeDistribution { amount filterValue ${CHART_BUCKET_FIELDS} }`,
  vehicleBrands: `vehicleBrandDistribution { filterValue ${CHART_BUCKET_FIELDS} }`,
  phoneBrandModels: `phoneBrandDistribution { amount filterValue ${CHART_BUCKET_FIELDS} }`,
  locationTypes: `locationTypeDistribution { filterValue ${CHART_BUCKET_FIELDS} }`,
} as const;

export type ChartFacet = keyof typeof CHART_FACET_FIELDS;

export function chartFacetQuery(facet: ChartFacet): string {
  return `query MapFeaturesCharts($filter: MapFeatureFilterInput) {
    mapFeaturesCharts(filter: $filter) { ${CHART_FACET_FIELDS[facet]} }
  }`;
}
