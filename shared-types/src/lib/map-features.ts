export interface LocationData {
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  cep?: string;
  tipo_local?: string;
  subtipo_local?: string;
}
export interface OccurrenceMetadata {
  hora_ocorrencia?: string;
  periodo?: string;
  delegacia?: string;
  delegacia_circunscricao?: string;
  departamento?: string;
  seccional?: string;
  natureza_apurada?: string;
  conduta?: string;
  autoria?: string;
  flagrante?: boolean;
  data_registro?: string;
  data_comunicacao?: string;
}
export interface ImlRecord {
  sourceId: number;
  sourceTable: string;
  dataEntradaIml: string | null;
  anoBo: string | null;
  numBo: string | null;
  delegaciaRegistro: string | null;
  numeroLaudo: string | null;
  anoLaudo: string | null;
  idadeVitima: string | null;
  tipoIdade: string | null;
  conclusao: string | null;
  declaracaoObito: string | null;
  causaMortis: string | null;
}
interface BaseRecord {
  source_id: number;
  source_table: string;
  rubrica?: string;
}
export interface CelularRecord extends BaseRecord {
  type: 'celular';
  descr_modo_objeto?: string;
  descr_tipo_objeto?: string;
  descr_subtipo_objeto?: string;
  marca?: string;
  quantidade?: number;
  bloqueio?: boolean;
  desbloqueio?: boolean;
}
export interface VeiculoRecord extends BaseRecord {
  type: 'veiculo';
  descr_ocorrencia?: string;
  tipo_veiculo?: string;
  marca?: string;
  cor?: string;
  placa?: string;
  ano_fabricacao?: number;
  ano_modelo?: number;
}
export interface ObjetoRecord extends BaseRecord {
  type: 'objeto';
  descr_modo_objeto?: string;
  descr_tipo_objeto?: string;
  descr_subtipo_objeto?: string;
  marca?: string;
  quantidade?: number;
}
export interface DadosCriminaisRecord extends BaseRecord {
  type: 'dados_criminais';
  natureza_apurada?: string;
  conduta?: string;
}
export interface ProdutividadeArmasRecord extends BaseRecord {
  type: 'produtividade_armas';
  descricao_apresentacao?: string;
  natureza_apurada?: string;
  descr_modo_objeto?: string;
  tipo_arma?: string;
  marca?: string;
  calibre?: string;
}
export interface ProdutividadeEntorpecentesRecord extends BaseRecord {
  type: 'produtividade_entorpecentes';
  descricao_apresentacao?: string;
  natureza_apurada?: string;
  tipo_droga?: string;
  quantidade_gramas?: number;
}
export interface ProdutividadeVeiculosRecord extends BaseRecord {
  type: 'produtividade_veiculos';
  descricao_apresentacao?: string;
  natureza_apurada?: string;
  descr_ocorrencia?: string;
  tipo_veiculo?: string;
  marca?: string;
  cor?: string;
  placa?: string;
  ano_fabricacao?: number;
  ano_modelo?: number;
}
export interface ProdutividadePessoaRecord extends BaseRecord {
  type: 'produtividade_pessoa';
  descricao_apresentacao?: string;
  natureza_apurada?: string;
  tipo_pessoa?: string;
  sexo?: string;
  idade?: number;
  cor?: string;
  profissao?: string;
  grau_instrucao?: string;
  nacionalidade?: string;
}
export type SourceRecord =
  | CelularRecord
  | VeiculoRecord
  | ObjetoRecord
  | DadosCriminaisRecord
  | ProdutividadeArmasRecord
  | ProdutividadeEntorpecentesRecord
  | ProdutividadeVeiculosRecord
  | ProdutividadePessoaRecord;
export interface FeatureDataSummary {
  total_records: number;
  celulares_count: number;
  veiculos_count: number;
  objetos_count: number;
  dados_criminais_count: number;
  produtividade_count: number;
}
export interface MapFeatureData {
  location: LocationData;
  occurrence: OccurrenceMetadata;
  all_rubricas: string[];
  records: SourceRecord[];
  summary: FeatureDataSummary;
}

export type SourceTableType =
  | 'celulares'
  | 'veiculos'
  | 'objetos'
  | 'dados_criminais'
  | 'produtividade_armas'
  | 'produtividade_entorpecentes'
  | 'produtividade_veiculos_recuperados'
  | 'produtividade_presos'
  | 'produtividade_prisoes'
  | 'produtividade_flagrantes'
  | 'produtividade_eca';

export interface MapFeature {
  id: string;
  num_bo: string;
  ano_bo: number;
  delegacia: string | null;
  latitude: number;
  longitude: number;
  location_hash: string;
  geom: unknown;
  category: string;
  rubrica_for_styling: string;
  data_ocorrencia: Date | null;
  source_tables: string[];
  feature_data: MapFeatureData;
  created_at: Date;
  updated_at: Date;
}

/**
 * Lightweight map feature row for list/detail-link queries.
 * It intentionally omits feature_data so summary queries do not pull the
 * JSONB payload unless full detail is required.
 */
export interface MapFeatureSummaryRecord {
  id: string;
  num_bo: string;
  ano_bo: number;
  delegacia: string | null;
  latitude: number;
  longitude: number;
  category: string;
  rubrica_for_styling: string;
  data_ocorrencia: Date | null;
  source_tables: string[];
}

export interface MapFeaturesEtlStatus {
  id: string;
  source_table: string;
  last_etl_at: Date | null;
  rows_processed: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SourceTableConfig {
  tablePattern: string;
  recordType: SourceRecord['type'];
  columnMappings: {
    num_bo: string;
    ano_bo: string;
    latitude: string;
    longitude: string;
    data_ocorrencia: string;
    rubrica?: string;
    delegacia: string;
  };
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ) => SourceRecord;
  derivedCategory?: string;
  stylingRubrica?: string;
}

export interface MapFeaturesTileParams {
  z: number;
  x: number;
  y: number;
  beforeDate?: string;
  afterDate?: string;
  categories?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
}

export interface MapFeaturesCategoryStats {
  name: string;
  count: number;
  rubricaForStyling: string;
  sourceType: 'rubrica' | 'derived';
}

export interface MapFeaturesPeriodStats {
  name: string;
  count: number;
}

export interface MapFeaturesCategoryPeriodStats {
  categories: MapFeaturesCategoryStats[];
  periods: MapFeaturesPeriodStats[];
}

export interface MapFeaturesFilterParams {
  beforeDate?: string;
  afterDate?: string;
  categories?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
}

export interface MapFeatureResponse {
  id: string;
  numBo: string;
  anoBo: number;
  /** Registration police unit, required to disambiguate pre-2022 BO numbers. */
  delegacia: string | null;
  latitude: number;
  longitude: number;
  category: string;
  rubricaForStyling: string;
  dataOcorrencia: string | null;
  sourceTables: string[];
  featureData: MapFeatureData;
  imlRecords: ImlRecord[];
}
export function isCelularRecord(record: SourceRecord): record is CelularRecord {
  return record.type === 'celular';
}

export function isVeiculoRecord(record: SourceRecord): record is VeiculoRecord {
  return record.type === 'veiculo';
}

export function isObjetoRecord(record: SourceRecord): record is ObjetoRecord {
  return record.type === 'objeto';
}

export function isDadosCriminaisRecord(
  record: SourceRecord
): record is DadosCriminaisRecord {
  return record.type === 'dados_criminais';
}

export function isProdutividadeArmasRecord(
  record: SourceRecord
): record is ProdutividadeArmasRecord {
  return record.type === 'produtividade_armas';
}

export function isProdutividadeEntorpecentesRecord(
  record: SourceRecord
): record is ProdutividadeEntorpecentesRecord {
  return record.type === 'produtividade_entorpecentes';
}

export function isProdutividadeVeiculosRecord(
  record: SourceRecord
): record is ProdutividadeVeiculosRecord {
  return record.type === 'produtividade_veiculos';
}

export function isProdutividadePessoaRecord(
  record: SourceRecord
): record is ProdutividadePessoaRecord {
  return record.type === 'produtividade_pessoa';
}
