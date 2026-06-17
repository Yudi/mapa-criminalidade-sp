export interface UnifiedOccurrence {
  id: string;
  sourceTable: string;
  numBo: string;
  anoBo: number | null;
  category: string;
  rubricaForStyling: string;
  latitude: number;
  longitude: number;
  dataOcorrencia: string | null;
  horaOcorrencia: string | null;
  dataRegistro: string | null;
  logradouro: string | null;
  numeroLogradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  localTipo: string | null;
  periodo: string | null;
  conduta: string | null;
  naturezaApurada: string | null;
  delegacia: string | null;
}
export interface GroupedOccurrence {
  numBo: string;
  anoBo: number;
  latitude: number;
  longitude: number;
  primaryCategory: string;
  allCategories: string[];
  recordCount: number;
  occurrences: UnifiedOccurrence[];
  sourceTables: string[];
}
export type CategorySourceType = 'rubrica' | 'derived';
export interface CategoryInfo {
  name: string;
  count: number;
  rubricaForStyling: string;
  sourceType: CategorySourceType;
}
export interface PeriodInfo {
  name: string;
  count: number;
}
export interface GeoTableInfo {
  tableName: string;
  columns: string[];
  columnTypes: Record<string, string>;
  hasRubrica: boolean;
  hasNumBo: boolean;
  hasGeometry: boolean;
  recordCount: number;
  derivedCategory: string | null;
  latitudeColumn: string | null;
  longitudeColumn: string | null;
  dateColumn: string | null;
  hourColumn: string | null;
}
export interface TablesByType {
  dados_criminais: string[];
  celulares: string[];
  veiculos: string[];
  objetos: string[];
  mdip: string[];
  produtividade: string[];
  outros: string[];
}
export interface CoordinateQualityReport {
  tableName: string;
  totalRows: number;
  validGeometry: number;
  nullGeometry: number;
  hasCoordinates: number;
  nullCoordinates: number;
  invalidCoordinates: number;
  qualityPercent: number;
}
export interface DateRange {
  earliest: string | null;
  latest: string | null;
  defaultAfter: string | null;
}
export interface OccurrenceStats {
  totalRecords: number;
  uniqueBoletins: number;
  recordsByTable: { tableName: string; count: number }[];
  recordsByCategory: { category: string; count: number }[];
  dateRange: DateRange;
}
export interface OccurrenceTileMetadata {
  format: string;
  minZoom: number;
  maxZoom: number;
  layers: string[];
  availableCategories: string[];
  availableRubricas: string[];
  availablePeriods: string[];
  tileUrlTemplate: string;
}
export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}
export interface PointRadius {
  longitude: number;
  latitude: number;
  radius: number;
}
export interface OccurrenceQueryParams {
  beforeDate?: string;
  afterDate?: string;
  categories?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
  tables?: string[];
  bbox?: BoundingBox;
  point?: PointRadius;
  limit?: number;
  offset?: number;
}
export interface TileQueryParams {
  before?: string;
  after?: string;
  categories?: string[];
  rubricas?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
}
export type OccurrenceResponse = UnifiedOccurrence;
export type GroupedOccurrenceResponse = GroupedOccurrence;
export type CategoryResponse = CategoryInfo;
export interface GeoTableResponse {
  tableName: string;
  hasRubrica: boolean;
  derivedCategory: string | null;
  recordCount: number;
  hasGeometry: boolean;
}
export interface TableSchemaResponse extends GeoTableInfo {
  columnMappings: Record<string, string>;
}
