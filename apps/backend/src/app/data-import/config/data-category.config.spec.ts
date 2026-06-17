import { DataCategoryConfig } from './data-category.config';
import { dataCategorySchema } from '../schemas/data-category.schema';

describe('DataCategoryConfig', () => {
  it('filters productivity workbooks by configured sheet pattern', () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Produtividade - Veículos Recuperados'
    );

    if (!category) {
      throw new Error('Category not found');
    }

    const result = DataCategoryConfig.filterCsvFilesForCategory(
      [
        'DadosProdutividade_2024_PRESOS E APREENDIDOS_2024.csv',
        'DadosProdutividade_2024_Nº VEÍCULOS RECUPERADOS_2024.csv',
        'DadosProdutividade_2024_ARMAS DE FOGO APREENDIDAS_2024.csv',
      ],
      category
    );

    expect(result).toEqual([
      'DadosProdutividade_2024_Nº VEÍCULOS RECUPERADOS_2024.csv',
    ]);
  });

  it('keeps every CSV when a category has no sheet pattern', () => {
    const category = DataCategoryConfig.getCategoryByName('Dados Criminais');

    if (!category) {
      throw new Error('Category not found');
    }

    const files = [
      'SPDadosCriminais_2024_JAN-JUN_2024.csv',
      'SPDadosCriminais_2024_JUL-DEZ_2024.csv',
    ];

    expect(DataCategoryConfig.filterCsvFilesForCategory(files, category)).toBe(
      files
    );
  });

  it('includes 2026 in every configured data category', () => {
    expect(
      DataCategoryConfig.getDataCategories().every((category) =>
        category.years.includes(2026)
      )
    ).toBe(true);
  });

  it('keeps MDIP on the cumulative table while using the 2026 source URL', () => {
    const category = DataCategoryConfig.getCategoryByName('MDIP');

    if (!category) {
      throw new Error('Category not found');
    }

    expect(DataCategoryConfig.getTableName(category, 2026)).toBe('mdip');
    expect(DataCategoryConfig.getUrl(category, 2026)).toBe(
      'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/MDIP_2026.xlsx'
    );
  });

  it('configures IML as a specialized low-priority scraper category', () => {
    const category = DataCategoryConfig.getImlCategory();

    expect(category).toMatchObject({
      name: 'Registro de Óbitos - IML',
      tablePrefix: 'registro_obitos_iml',
      importStrategy: 'ssp-iml',
    });
    expect(DataCategoryConfig.getTableName(category, 2013)).toBe(
      'registro_obitos_iml_2013'
    );
    expect(DataCategoryConfig.getDirectCategories()).not.toContain(category);
  });

  it('imports HORA_FATO as text because MDIP may use descriptive period labels', () => {
    const category = DataCategoryConfig.getCategoryByName('MDIP');

    if (!category) {
      throw new Error('Category not found');
    }

    expect(DataCategoryConfig.getColumnTypeOverrides(category)).toEqual(
      expect.objectContaining({
        HORA_FATO: 'TEXT',
        HORA_OCORRENCIA: 'TIME',
      })
    );
  });

  it('matches 2026 productivity sheet names with existing patterns', () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Produtividade - Entorpecentes Apreensão'
    );

    if (!category) {
      throw new Error('Category not found');
    }

    expect(
      DataCategoryConfig.filterCsvFilesForCategory(
        [
          'DadosProdutividade_2026_APREENSAO DE ENTORPECENTES_2026.csv',
          'DadosProdutividade_2026_ENTORPECENTES_GRAMAS_2026.csv',
        ],
        category
      )
    ).toEqual([
      'DadosProdutividade_2026_APREENSAO DE ENTORPECENTES_2026.csv',
    ]);
  });

  it('keeps configured categories valid against the runtime schema', () => {
    expect(() =>
      DataCategoryConfig.getDataCategories().forEach((category) =>
        dataCategorySchema.parse(category)
      )
    ).not.toThrow();
  });

  it('rejects invalid table prefixes in category config', () => {
    expect(() =>
      dataCategorySchema.parse({
        name: 'Invalid',
        baseUrl: 'https://example.com/data_',
        years: [2026],
        tablePrefix: 'Invalid Prefix',
        hasSchema: true,
      })
    ).toThrow();
  });
});
