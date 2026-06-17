const CATEGORY_FIELDS = `
  name
  count
  rubricaForStyling
  sourceType
`;

const PERIOD_FIELDS = `
  name
  count
`;

const CHART_BUCKET_FIELDS = `
  label
  count
  amount
`;

const GROUPED_OCCURRENCE_FIELDS = `
  numBo
  anoBo
  latitude
  longitude
  primaryCategory
  allCategories
  recordCount
  sourceTables
  occurrences {
    id
    sourceTable
    numBo
    anoBo
    category
    rubricaForStyling
    latitude
    longitude
    dataOcorrencia
    horaOcorrencia
    dataRegistro
    logradouro
    numeroLogradouro
    bairro
    cidade
    localTipo
    periodo
    conduta
    naturezaApurada
    delegacia
  }
`;

const FEATURE_DETAIL_FIELDS = `
  id
  numBo
  anoBo
  delegacia
  latitude
  longitude
  category
  rubricaForStyling
  dataOcorrencia
  sourceTables
  featureData {
    location {
      logradouro
      numero
      bairro
      cidade
      cep
      tipo_local
      subtipo_local
    }
    occurrence {
      hora_ocorrencia
      periodo
      delegacia
      delegacia_circunscricao
      departamento
      seccional
      natureza_apurada
      conduta
      autoria
      flagrante
      data_registro
      data_comunicacao
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
      desbloqueio
      tipo_veiculo
      cor
      placa
      ano_fabricacao
      ano_modelo
      natureza_apurada
      conduta
      tipo_arma
      calibre
      tipo_droga
      quantidade_gramas
      tipo_pessoa
      sexo
      idade
      cor
      profissao
      grau_instrucao
      nacionalidade
    }
    summary {
      total_records
      celulares_count
      veiculos_count
      objetos_count
      dados_criminais_count
      produtividade_count
    }
  }
  imlRecords {
    sourceId
    sourceTable
    dataEntradaIml
    anoBo
    numBo
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
      format
      minZoom
      maxZoom
      layers
      availableCategories
      availableRubricas
      availablePeriods
      tileUrlTemplate
      totalFeatures
      dateRange {
        earliest
        latest
        defaultAfter
      }
      categoryStats {
        ${CATEGORY_FIELDS}
      }
      periodStats {
        ${PERIOD_FIELDS}
      }
    }
  }
`;

export const MAP_FEATURES_CATEGORIES_QUERY = `
  query MapFeaturesCategories($filter: MapFeatureFilterInput) {
    mapFeaturesCategories(filter: $filter) {
      ${CATEGORY_FIELDS}
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

export const MAP_FEATURES_PERIODS_QUERY = `
  query MapFeaturesPeriods($filter: MapFeatureFilterInput) {
    mapFeaturesPeriods(filter: $filter) {
      ${PERIOD_FIELDS}
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
        ${CHART_BUCKET_FIELDS}
      }
      recordTypeDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      objectTypeDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      vehicleBrandDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      phoneBrandDistribution {
        ${CHART_BUCKET_FIELDS}
      }
      locationTypeDistribution {
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

export const MAP_FEATURE_FULL_QUERY = `
  query MapFeatureFull($input: MapFeatureLookupInput!) {
    mapFeatureFull(input: $input) {
      ${FEATURE_DETAIL_FIELDS}
    }
  }
`;
