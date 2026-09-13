import type {
  CategoryInfo as FullCategoryInfo,
  CensusAreaDetail as FullCensusAreaDetail,
  CensusReleaseSummary,
  MapFeatureResponse,
  MapFeaturesStartupMetadata,
  PeriodInfo,
  GroupedOccurrence as FullGroupedOccurrence,
  UnifiedOccurrence as FullUnifiedOccurrence,
} from '@mapa-criminalidade/shared-types';

export type CategoryInfo = Omit<FullCategoryInfo, 'sourceType'>;
export interface CategoryPeriodStats {
  categories: CategoryInfo[];
  periods: PeriodInfo[];
}
export type StartupMetadata = Pick<
  MapFeaturesStartupMetadata,
  'datasetRevision' | 'dateRange'
>;
export type CensusRelease = Pick<CensusReleaseSummary, 'id' | 'year'>;
export type CensusAreaDetail = Omit<FullCensusAreaDetail, 'indicators'> & {
  indicators: Omit<
    FullCensusAreaDetail['indicators'][number],
    'sourceUrl' | 'variables' | 'universe'
  >[];
};
export type FeatureDetail = Pick<
  MapFeatureResponse,
  'imlUnavailable' | 'dataOcorrencia'
> & {
  featureData: Omit<MapFeatureResponse['featureData'], 'summary'>;
  imlRecords: Omit<
    MapFeatureResponse['imlRecords'][number],
    'anoBo' | 'numBo'
  >[];
};

export type UnifiedOccurrence = Pick<
  FullUnifiedOccurrence,
  | 'dataOcorrencia'
  | 'horaOcorrencia'
  | 'dataRegistro'
  | 'logradouro'
  | 'numeroLogradouro'
  | 'bairro'
  | 'cidade'
  | 'localTipo'
  | 'conduta'
  | 'naturezaApurada'
>;
export type GroupedOccurrence = Pick<
  FullGroupedOccurrence,
  'numBo' | 'anoBo' | 'primaryCategory'
> & {
  occurrences: UnifiedOccurrence[];
};
