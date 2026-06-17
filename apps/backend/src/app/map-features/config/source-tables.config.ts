import {
  SourceTableConfig,
  CelularRecord,
  VeiculoRecord,
  ObjetoRecord,
  DadosCriminaisRecord,
  ProdutividadeArmasRecord,
  ProdutividadeEntorpecentesRecord,
  ProdutividadeVeiculosRecord,
  ProdutividadePessoaRecord,
} from '../types/map-features.types';
import {
  parseSourceBooleanFlag,
  parseSourceInteger,
  parseSourceNumber,
  sourceValueToString,
} from '../utils/source-value.utils';

// Hardcoded because source schemas are known and ETL depends on explicit mappings.
// NOME_DELEGACIA is the registration police unit used to disambiguate older BOs
// and is available across supported sources. ID_DELEGACIA is not available in
// all of them. Circumscription is separate: NOME_DELEGACIA_CIRC(_UNSCRICAO).

function optionalString(
  row: Record<string, unknown>,
  ...columns: string[]
): string | undefined {
  for (const column of columns) {
    const value = sourceValueToString(row[column]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

const celularesConfig: SourceTableConfig = {
  tablePattern: 'celulares',
  recordType: 'celular',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    rubrica: 'RUBRICA',
    delegacia: 'NOME_DELEGACIA',
  },
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): CelularRecord => ({
    type: 'celular',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    rubrica: optionalString(row, 'RUBRICA'),
    descr_modo_objeto: optionalString(row, 'DESCR_MODO_OBJETO'),
    descr_tipo_objeto: optionalString(row, 'DESCR_TIPO_OBJETO'),
    descr_subtipo_objeto: optionalString(row, 'DESCR_SUBTIPO_OBJETO'),
    marca: optionalString(row, 'MARCA_OBJETO'),
    quantidade: parseSourceInteger(row.QUANTIDADE_OBJETO) ?? undefined,
    bloqueio: parseSourceBooleanFlag(row.FLAG_BLOQUEIO),
    desbloqueio: parseSourceBooleanFlag(row.FLAG_DESBLOQUEIO),
  }),
};
const veiculosConfig: SourceTableConfig = {
  tablePattern: 'veiculos',
  recordType: 'veiculo',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    rubrica: 'RUBRICA',
    delegacia: 'NOME_DELEGACIA',
  },
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): VeiculoRecord => ({
    type: 'veiculo',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    rubrica: optionalString(row, 'RUBRICA'),
    descr_ocorrencia: optionalString(row, 'DESCR_OCORRENCIA_VEICULO'),
    tipo_veiculo: optionalString(row, 'DESCR_TIPO_VEICULO'),
    marca: optionalString(row, 'DESCR_MARCA_VEICULO'),
    cor: optionalString(row, 'DESC_COR_VEICULO'),
    placa: optionalString(row, 'PLACA_VEICULO'),
    ano_fabricacao: parseSourceInteger(row.ANO_FABRICACAO) ?? undefined,
    ano_modelo: parseSourceInteger(row.ANO_MODELO) ?? undefined,
  }),
};
const objetosConfig: SourceTableConfig = {
  tablePattern: 'objetos',
  recordType: 'objeto',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    rubrica: 'RUBRICA',
    delegacia: 'NOME_DELEGACIA',
  },
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): ObjetoRecord => ({
    type: 'objeto',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    rubrica: optionalString(row, 'RUBRICA'),
    descr_modo_objeto: optionalString(row, 'DESCR_MODO_OBJETO'),
    descr_tipo_objeto: optionalString(row, 'DESCR_TIPO_OBJETO'),
    descr_subtipo_objeto: optionalString(row, 'DESCR_SUBTIPO_OBJETO'),
    marca: optionalString(row, 'MARCA_OBJETO'),
    quantidade: parseSourceInteger(row.QUANTIDADE_OBJETO) ?? undefined,
  }),
};

/**
 * Configuration for dados_criminais tables (2022-2025)
 * Note: Schema varies slightly between years:
 * - 2022: CIDADE, DATA_COMUNICACAO_BO, DESCR_PERIOD, DESCR_TIPOLOCAL
 * - 2023-2024: NOME_MUNICIPIO, DATA_REGISTRO, DESC_PERIODO, DESCR_SUBTIPOLOCAL
 * - 2025: Adds CMD, BTL, CIA columns
 *
 * We handle this by checking for column existence
 */
const dadosCriminaisConfig: SourceTableConfig = {
  tablePattern: 'dados_criminais',
  recordType: 'dados_criminais',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    rubrica: 'RUBRICA',
    delegacia: 'NOME_DELEGACIA',
  },
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): DadosCriminaisRecord => ({
    type: 'dados_criminais',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    rubrica: optionalString(row, 'RUBRICA'),
    natureza_apurada: optionalString(row, 'NATUREZA_APURADA'),
    conduta: optionalString(row, 'DESCR_CONDUTA'),
  }),
};
const produtividadeArmasConfig: SourceTableConfig = {
  tablePattern: 'produtividade_armas',
  recordType: 'produtividade_armas',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'Apreensão de Armas',
  stylingRubrica: 'PORTE ILEGAL DE ARMA DE FOGO DE USO PERMITIDO',
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): ProdutividadeArmasRecord => ({
    type: 'produtividade_armas',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    descricao_apresentacao: optionalString(row, 'DESCRICAO_APRESENTACAO'),
    natureza_apurada: optionalString(row, 'NATUREZA_APURADA'),
    descr_modo_objeto: optionalString(row, 'DESC_OBJETO_MODO'),
    tipo_arma: optionalString(row, 'DESC_ARMA_FOGO'),
    marca: optionalString(row, 'ARMA_NOME_MARCA'),
    calibre: optionalString(row, 'CALIBRE'),
  }),
};
const produtividadeEntorpecentesConfig: SourceTableConfig = {
  tablePattern: 'produtividade_entorpecentes',
  recordType: 'produtividade_entorpecentes',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'Apreensão de Entorpecentes',
  stylingRubrica: 'TRÁFICO DE DROGAS',
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): ProdutividadeEntorpecentesRecord => ({
    type: 'produtividade_entorpecentes',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    descricao_apresentacao: optionalString(row, 'DESCRICAO_APRESENTACAO'),
    natureza_apurada: optionalString(row, 'NATUREZA_APURADA'),
    tipo_droga: optionalString(row, 'DESCR_TOXICO'),
    quantidade_gramas: parseSourceNumber(row.QTDE_GRAMAS_ARRED) ?? undefined,
  }),
};
const produtividadeVeiculosConfig: SourceTableConfig = {
  tablePattern: 'produtividade_veiculos_recuperados',
  recordType: 'produtividade_veiculos',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'Veículos Recuperados',
  stylingRubrica: 'RECUPERAÇÃO DE VEÍCULO',
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): ProdutividadeVeiculosRecord => ({
    type: 'produtividade_veiculos',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    descricao_apresentacao: optionalString(row, 'DESCRICAO_APRESENTACAO'),
    natureza_apurada: optionalString(row, 'NATUREZA_APURADA'),
    descr_ocorrencia: optionalString(row, 'DESCR_OCORRENCIA_VEICULO'),
    tipo_veiculo: optionalString(row, 'DESCR_TIPO_VEICULO'),
    marca: optionalString(row, 'DESCR_MARCA_VEICULO'),
    cor: optionalString(row, 'DESC_COR_VEICULO'),
    placa: optionalString(row, 'PLACA_VEICULO'),
    ano_fabricacao: parseSourceInteger(row.ANO_FABRICACAO) ?? undefined,
    ano_modelo: parseSourceInteger(row.ANO_MODELO) ?? undefined,
  }),
};
const produtividadePessoasConfig: SourceTableConfig = {
  tablePattern: 'produtividade_presos',
  recordType: 'produtividade_pessoa',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'Presos',
  stylingRubrica: 'PRISÃO EM FLAGRANTE',
  extractRecord: (
    row: Record<string, unknown>,
    tableName: string
  ): ProdutividadePessoaRecord => ({
    type: 'produtividade_pessoa',
    source_id: parseSourceInteger(row.id) ?? 0,
    source_table: tableName,
    descricao_apresentacao: optionalString(row, 'DESCRICAO_APRESENTACAO'),
    natureza_apurada: optionalString(row, 'NATUREZA_APURADA'),
    tipo_pessoa: optionalString(row, 'DESCR_TIPO_PESSOA'),
    sexo: optionalString(row, 'SEXO_PESSOA'),
    idade: parseSourceInteger(row.IDADE_PESSOA) ?? undefined,
    cor: optionalString(row, 'COR_CUTIS', 'COR_CURTIS'),
    profissao: optionalString(row, 'DESCR_PROFISSAO'),
    grau_instrucao: optionalString(row, 'DESCR_GRAU_INSTRUCAO'),
    nacionalidade: optionalString(row, 'NACIONALIDADE_PESSOA'),
  }),
};
const produtividadePrisoesConfig: SourceTableConfig = {
  tablePattern: 'produtividade_prisoes_efetuadas',
  recordType: 'produtividade_pessoa',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'Prisões Efetuadas',
  stylingRubrica: 'PRISÃO EM FLAGRANTE',
  extractRecord: produtividadePessoasConfig.extractRecord,
};
const produtividadeFlagrantesConfig: SourceTableConfig = {
  tablePattern: 'produtividade_flagrantes_lavrados',
  recordType: 'produtividade_pessoa',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'Flagrantes Lavrados',
  stylingRubrica: 'PRISÃO EM FLAGRANTE',
  extractRecord: produtividadePessoasConfig.extractRecord,
};
const produtividadeEcaConfig: SourceTableConfig = {
  tablePattern: 'produtividade_137_eca',
  recordType: 'produtividade_pessoa',
  columnMappings: {
    num_bo: 'NUM_BO',
    ano_bo: 'ANO_BO',
    latitude: 'LATITUDE',
    longitude: 'LONGITUDE',
    data_ocorrencia: 'DATA_OCORRENCIA_BO',
    delegacia: 'NOME_DELEGACIA',
  },
  derivedCategory: 'ECA Art. 137',
  stylingRubrica: 'ATO INFRACIONAL',
  extractRecord: produtividadePessoasConfig.extractRecord,
};
export const SOURCE_TABLE_CONFIGS: SourceTableConfig[] = [
  produtividadeArmasConfig,
  produtividadeEntorpecentesConfig,
  produtividadeVeiculosConfig,
  produtividadePessoasConfig,
  produtividadePrisoesConfig,
  produtividadeFlagrantesConfig,
  produtividadeEcaConfig,
  dadosCriminaisConfig,
  celularesConfig,
  veiculosConfig,
  objetosConfig,
];
export function getSourceTableConfig(
  tableName: string
): SourceTableConfig | null {
  for (const config of SOURCE_TABLE_CONFIGS) {
    if (tableName.startsWith(config.tablePattern)) {
      return config;
    }
  }
  return null;
}
export function isMapFeaturesSourceTable(tableName: string): boolean {
  return getSourceTableConfig(tableName) !== null;
}
export const LOCATION_COLUMN_MAPPINGS: Record<string, string[]> = {
  logradouro: ['LOGRADOURO'],
  numero: ['NUMERO_LOGRADOURO'],
  bairro: ['BAIRRO'],
  cidade: ['CIDADE', 'NOME_MUNICIPIO'],
  cep: ['CEP'],
  tipo_local: ['DESCR_TIPOLOCAL'],
  subtipo_local: ['DESCR_SUBTIPOLOCAL'],
};
export const OCCURRENCE_COLUMN_MAPPINGS: Record<string, string[]> = {
  hora_ocorrencia: ['HORA_OCORRENCIA', 'HORA_OCORRENCIA_BO', 'HORA_FATO'],
  periodo: ['DESCR_PERIODO', 'DESC_PERIODO'],
  delegacia: ['NOME_DELEGACIA'],
  delegacia_circunscricao: [
    'NOME_DELEGACIA_CIRC',
    'NOME_DELEGACIA_CIRCUNSCRICAO',
  ],
  departamento: ['NOME_DEPARTAMENTO'],
  seccional: ['NOME_SECCIONAL'],
  natureza_apurada: ['NATUREZA_APURADA'],
  conduta: ['DESCR_CONDUTA'],
  autoria: ['AUTORIA_BO'],
  flagrante: ['FLAG_FLAGRANTE'],
  data_registro: ['DATA_REGISTRO', 'DATAHORA_REGISTRO_BO'],
  data_comunicacao: ['DATA_COMUNICACAO_BO'],
};
