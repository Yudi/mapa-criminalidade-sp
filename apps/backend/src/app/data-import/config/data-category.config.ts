import { DataCategory } from '../types/data-import.types';
import { dataCategoriesSchema } from '../schemas/data-category.schema';

const commonColumnTypeOverrides: Record<string, string> = {
  ANO_BO: 'INT',
  ANO_ESTATISTICA: 'INT',
  ANO: 'INT',
  MES_ESTATISTICA: 'SMALLINT',
  ID_DELEGACIA: 'TEXT',
  NUM_BO: 'TEXT',
  DATA_REGISTRO: 'DATE',
  DATA_OCORRENCIA_BO: 'DATE',
  DATA_COMUNICACAO_BO: 'DATE',
  DATAHORA_REGISTRO_BO: 'DATE',
  DATAHORA_IMPRESSAO_BO: 'DATE',
  HORA_OCORRENCIA: 'TIME',
  HORA_OCORRENCIA_BO: 'TIME',
  HORA_FATO: 'TEXT',
  DATA_FATO: 'DATE',
  DATA_NASCIMENTO_PESSOA: 'DATE',
  CEP: 'TEXT',
  MES_REGISTRO_BO: 'SMALLINT',
  ANO_REGISTRO_BO: 'INT',
};
const imlFirstYear = 2013;
const imlCurrentYear = Number(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  }).format(new Date())
);
const imlYears = Array.from(
  { length: imlCurrentYear - imlFirstYear + 1 },
  (_, index) => imlFirstYear + index
);
const rawDataCategories: DataCategory[] = [
  {
    name: 'Dados Criminais',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/SPDadosCriminais_',
    years: [2022, 2023, 2024, 2025, 2026],
    tablePrefix: 'dados_criminais',
    hasSchema: true,
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Armas',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_armas',
    hasSchema: true,
    sheetNamePatterns: ['ARMAS DE FOGO APREENDIDAS'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - 137 ECA',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_137_eca',
    hasSchema: true,
    sheetNamePatterns: ['ART.173-ECA'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Entorpecentes Apreensão',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_entorpecentes_apreensao',
    hasSchema: true,
    sheetNamePatterns: ['APREENSÃO DE ENTORPECENTE'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Entorpecentes Gramas',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_entorpecentes_gramas',
    hasSchema: true,
    sheetNamePatterns: ['ENTORPECENTES_GRAMAS'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Flagrantes Lavrados',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_flagrantes_lavrados',
    hasSchema: true,
    sheetNamePatterns: ['FLAGRANTES LAVRADOS'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Prisões Efetuadas',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_prisoes_efetuadas',
    hasSchema: true,
    sheetNamePatterns: ['PRISOES EFETUADAS'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Presos',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_presos',
    hasSchema: true,
    sheetNamePatterns: ['PRESOS E APREENDIDOS'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Produtividade - Veículos Recuperados',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/DadosProdutividade_',
    years: [2024, 2025, 2026],
    tablePrefix: 'produtividade_veiculos_recuperados',
    hasSchema: true,
    sheetNamePatterns: ['VEÍCULOS RECUPERADOS'],
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'MDIP',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/MDIP_',
    years: [2026],
    tablePrefix: 'mdip',
    hasSchema: true,
    useYearSuffix: false, // MDIP uses just 'mdip' table name
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Celulares Subtraídos',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/baseDados/celularesSub/CelularesSubtraidos_',
    years: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    tablePrefix: 'celulares',
    hasSchema: true,
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Veículos Subtraídos',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/baseDados/veiculosSub/VeiculosSubtraidos_',
    years: [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    tablePrefix: 'veiculos',
    hasSchema: true,
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Objetos Subtraídos',
    baseUrl:
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/baseDados/objetosSub/ObjetosSubtraidos_',
    years: [2022, 2023, 2024, 2025, 2026],
    tablePrefix: 'objetos',
    hasSchema: true,
    columnTypeOverrides: commonColumnTypeOverrides,
  },
  {
    name: 'Registro de Óbitos - IML',
    baseUrl: 'https://www.ssp.sp.gov.br/transparenciassp/Consultas.aspx',
    years: imlYears,
    tablePrefix: 'registro_obitos_iml',
    hasSchema: true,
    importStrategy: 'ssp-iml',
  },
];

export class DataCategoryConfig {
  static readonly dataCategories: DataCategory[] =
    dataCategoriesSchema.parse(rawDataCategories);
  static getDataCategories(): DataCategory[] {
    return this.dataCategories;
  }
  static getValidCategories(): DataCategory[] {
    return this.dataCategories.filter((category) => category.hasSchema);
  }
  static getDirectCategories(): DataCategory[] {
    return this.getValidCategories().filter(
      (category) => category.importStrategy !== 'ssp-iml'
    );
  }
  static getImlCategory(): DataCategory {
    const category = this.dataCategories.find(
      (item) => item.importStrategy === 'ssp-iml'
    );

    if (!category) {
      throw new Error('Registro de Óbitos - IML category is not configured');
    }

    return category;
  }
  static getCategoryByName(name: string): DataCategory | undefined {
    return this.dataCategories.find((category) => category.name === name);
  }
  static getTableName(category: DataCategory, year: number): string {
    return category.useYearSuffix === false
      ? category.tablePrefix
      : `${category.tablePrefix}_${year}`;
  }
  static getUrl(category: DataCategory, year: number): string {
    return `${category.baseUrl}${year}.xlsx`;
  }

  static filterCsvFilesForCategory(
    csvFiles: string[],
    category: DataCategory
  ): string[] {
    return this.filterTabularFilesForCategory(csvFiles, category);
  }

  static filterParquetFilesForCategory(
    parquetFiles: string[],
    category: DataCategory
  ): string[] {
    return this.filterTabularFilesForCategory(parquetFiles, category);
  }

  static filterTabularFilesForCategory(
    files: string[],
    category: DataCategory
  ): string[] {
    if (!category.sheetNamePatterns?.length) {
      return files;
    }

    const normalizedPatterns = category.sheetNamePatterns.map((pattern) =>
      this.normalizeForPatternMatch(pattern)
    );

    return files.filter((file) => {
      const normalizedFile = this.normalizeForPatternMatch(file);
      return normalizedPatterns.some((pattern) =>
        normalizedFile.includes(pattern)
      );
    });
  }

  static getColumnTypeOverrides(
    category: DataCategory
  ): Record<string, string> {
    return category.columnTypeOverrides ?? {};
  }

  private static normalizeForPatternMatch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }
}
