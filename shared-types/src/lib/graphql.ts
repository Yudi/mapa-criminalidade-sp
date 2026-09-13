import type {
  CategoryInfo,
  DateRange,
  GroupedOccurrence,
  OccurrenceTileMetadata,
  PeriodInfo,
} from './occurrences';
import type { MapFeatureResponse } from './map-features';
import type { MapFeaturesCategoryPeriodStats } from './map-features';

export const GRAPHQL_REQUEST_TIMEOUT_CODE = 'REQUEST_TIMEOUT';

export interface GraphQLRequest<TVariables = Record<string, unknown>> {
  query: string;
  variables?: TVariables;
  operationName?: string;
}

export interface GraphQLErrorPayload {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLErrorPayload[];
}

export interface MapFeatureBoundsInput {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Values within a dimension are ORed; dimensions and rubricas are ANDed. */
export interface MapFeatureDetailFilters {
  vehicleBrands?: string[];
  objectTypes?: string[];
  phoneBrandModels?: string[];
  locationTypes?: string[];
  /** ISO weekdays, Monday = 1 and Sunday = 7. */
  weekdays?: number[];
}

export interface MapFeatureFilterInput extends MapFeatureDetailFilters {
  area?: import('./map-features').AnalysisArea;
  beforeDate?: string;
  afterDate?: string;
  categories?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
  bounds?: MapFeatureBoundsInput;
}

export interface MapFeatureLocationInput {
  longitude: number;
  latitude: number;
  radius: number;
  beforeDate?: string;
  afterDate?: string;
  periods?: string[];
  startHour?: number;
  endHour?: number;
}

export interface MapFeatureLookupInput {
  numBo: string;
  anoBo?: number;
  /** Registration police unit (source header: NOME_DELEGACIA). */
  delegacia?: string | null;
}

export interface MapFeatureSummary {
  id: string;
  numBo: string;
  anoBo: number;
  delegacia: string | null;
  latitude: number;
  longitude: number;
  category: string;
  rubricaForStyling: string;
  dataOcorrencia: string | null;
  sourceTables: string[];
}

export interface MapFeatureChartBucket {
  label: string;
  count: number;
  amount?: number | null;
  /** Exact filter value; null means this bucket cannot be selected. */
  filterValue?: string | null;
}

/** ISO weekday (Monday = 1); null preserves an unknown date or hour. */
export interface WeekdayHourBucket {
  weekday: number | null;
  hour: number | null;
  count: number;
}

export interface MapFeatureCharts {
  totalFeatures: number;
  totalRecords: number;
  categoryDistribution: MapFeatureChartBucket[];
  periodDistribution: MapFeatureChartBucket[];
  weekdayDistribution: MapFeatureChartBucket[];
  weekdayHourDistribution: WeekdayHourBucket[];
  recordTypeDistribution: MapFeatureChartBucket[];
  objectTypeDistribution: MapFeatureChartBucket[];
  vehicleBrandDistribution: MapFeatureChartBucket[];
  phoneBrandDistribution: MapFeatureChartBucket[];
  locationTypeDistribution: MapFeatureChartBucket[];
  policeCircumscriptionDistribution: MapFeatureChartBucket[];
  policeUnitDistribution: MapFeatureChartBucket[];
  weaponTypeDistribution: MapFeatureChartBucket[];
  drugTypeDistribution: MapFeatureChartBucket[];
}

export interface MapFeaturesMetadata extends OccurrenceTileMetadata {
  categoryStats: CategoryInfo[];
  periodStats: PeriodInfo[];
  dateRange: DateRange;
  totalFeatures: number;
}

export type MapFeaturesStartupMetadata = Omit<
  MapFeaturesMetadata,
  | 'availableCategories'
  | 'availableRubricas'
  | 'availablePeriods'
  | 'categoryStats'
  | 'periodStats'
  | 'totalFeatures'
>;

export interface MapFeaturesMetadataQuery {
  mapFeaturesMetadata: MapFeaturesStartupMetadata;
}

export interface MapFeaturesDateRangeQuery {
  mapFeaturesDateRange: DateRange;
}

export interface MapFeaturesCategoriesQuery {
  mapFeaturesCategories: CategoryInfo[];
}

export interface MapFeaturesCategoriesForLocationQuery {
  mapFeaturesCategoriesForLocation: CategoryInfo[];
}

export interface MapFeaturesPeriodsQuery {
  mapFeaturesPeriods: PeriodInfo[];
}

export interface MapFeaturesCategoryPeriodStatsQuery {
  mapFeaturesCategoryPeriodStats: MapFeaturesCategoryPeriodStats;
}

export interface MapFeaturesChartsQuery {
  mapFeaturesCharts: MapFeatureCharts;
}

export interface MapFeatureFullQuery {
  mapFeatureFull: MapFeatureResponse | null;
}

export interface GroupedOccurrenceByBoQuery {
  groupedOccurrenceByBo: GroupedOccurrence | null;
}

export interface MapFeaturesByBoQuery {
  mapFeaturesByBo: MapFeatureSummary[];
}

/** Exact occurrence aggregates; category counts can overlap for multi-category BOs. */
export interface MapFeatureTemporalStats {
  datasetRevision: string | null;
  total: number;
  monthly: MapFeatureChartBucket[];
  categories: MapFeatureChartBucket[];
}
