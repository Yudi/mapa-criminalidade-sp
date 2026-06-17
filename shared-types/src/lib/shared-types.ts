export interface GeometryPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}
export interface BoletimOcorrencia {
  id: number;
  nome_departamento: string | null;
  nome_seccional: string | null;
  nome_delegacia: string | null;
  cidade: string | null;
  ano_bo: number | null;
  num_bo: string | null;
  data_registro: string | null; // ISO date string for API compatibility
  data_ocorrencia_bo: string | null; // ISO date string for API compatibility
  hora_ocorrencia_bo: string | null;
  descr_periodo: string | null;
  descr_subtipolocal: string | null;
  bairro: string | null;
  logradouro: string | null;
  numero_logradouro: string | null;
  latitude: number | null;
  longitude: number | null;
  nome_delegacia_circunscricao: string | null;
  nome_departamento_circunscricao: string | null;
  nome_seccional_circunscricao: string | null;
  nome_municipio_circunscricao: string | null;
  rubrica: string | null;
  descr_conduta: string | null;
  natureza_apurada: string | null;
  mes_estatistica: number | null;
  ano_estatistica: number | null;
  location: GeometryPoint | null;
}
export interface DataFormValues {
  beforeDate: string;
  afterDate: string;
  street: string;
  city: string;
  state: string;
}
export interface ListRubricasForPointResponse {
  name: string;
  count: number;
}
export interface GetBoletinsByRubricaForPointResponse {
  rubrica: string;
  latitude: number;
  longitude: number;
}
export interface LocationQueryParams {
  lon: number;
  lat: number;
  radius: number;
  before?: string;
  after?: string;
}
export interface RubricaQueryParams extends LocationQueryParams {
  rubrica: string;
}
export interface TileMetadata {
  format: string;
  minZoom: number;
  maxZoom: number;
  layers: string[];
  availableRubricas: string[];
  tileUrlTemplate: string;
}
export interface TileFilterParams {
  before?: string;
  after?: string;
  rubricas?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
}
