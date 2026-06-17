import {
  OCCURRENCE_COLUMN_MAPPINGS,
  SOURCE_TABLE_CONFIGS,
} from './source-tables.config';
import type {
  ProdutividadePessoaRecord,
  ProdutividadeVeiculosRecord,
} from '../types/map-features.types';

describe('source table config', () => {
  it('maps MDIP HORA_FATO into occurrence time metadata', () => {
    expect(OCCURRENCE_COLUMN_MAPPINGS.hora_ocorrencia).toContain('HORA_FATO');
  });

  it('extracts productivity person fields across available year schemas', () => {
    const config = SOURCE_TABLE_CONFIGS.find(
      (sourceConfig) => sourceConfig.tablePattern === 'produtividade_presos'
    );

    expect(config).toBeDefined();

    const record = config?.extractRecord(
      {
        id: 1,
        DESCRICAO_APRESENTACAO: 'Preso em flagrante',
        DESCR_TIPO_PESSOA: 'Autor',
        SEXO_PESSOA: 'M',
        IDADE_PESSOA: '34',
        COR_CUTIS: 'Parda',
        COR_CURTIS: 'Ignorado',
        DESCR_PROFISSAO: 'Motorista',
        DESCR_GRAU_INSTRUCAO: 'Ensino médio',
        NACIONALIDADE_PESSOA: 'Brasileira',
        NATUREZA_APURADA: 'Tráfico de Drogas',
      },
      'produtividade_presos_2026'
    ) as ProdutividadePessoaRecord | undefined;

    expect(record).toMatchObject({
      descricao_apresentacao: 'Preso em flagrante',
      tipo_pessoa: 'Autor',
      sexo: 'M',
      idade: 34,
      cor: 'Parda',
      profissao: 'Motorista',
      grau_instrucao: 'Ensino médio',
      nacionalidade: 'Brasileira',
      natureza_apurada: 'Tráfico de Drogas',
    });
  });

  it('keeps the 2024 productivity person skin-color spelling fallback', () => {
    const config = SOURCE_TABLE_CONFIGS.find(
      (sourceConfig) => sourceConfig.tablePattern === 'produtividade_presos'
    );

    const record = config?.extractRecord(
      {
        id: 1,
        COR_CURTIS: 'Branca',
      },
      'produtividade_presos_2024'
    ) as ProdutividadePessoaRecord | undefined;

    expect(record?.cor).toBe('Branca');
  });

  it('extracts recovered vehicle productivity details', () => {
    const config = SOURCE_TABLE_CONFIGS.find(
      (sourceConfig) =>
        sourceConfig.tablePattern === 'produtividade_veiculos_recuperados'
    );

    const record = config?.extractRecord(
      {
        id: 1,
        DESCRICAO_APRESENTACAO: 'Veículo localizado',
        DESCR_OCORRENCIA_VEICULO: 'Recuperado',
        DESCR_TIPO_VEICULO: 'Automóvel',
        DESCR_MARCA_VEICULO: 'VW/Gol',
        DESC_COR_VEICULO: 'Prata',
        PLACA_VEICULO: 'ABC1234',
        ANO_FABRICACAO: '2018',
        ANO_MODELO: '2019',
        NATUREZA_APURADA: 'Roubo',
      },
      'produtividade_veiculos_recuperados_2026'
    ) as ProdutividadeVeiculosRecord | undefined;

    expect(record).toMatchObject({
      descricao_apresentacao: 'Veículo localizado',
      descr_ocorrencia: 'Recuperado',
      tipo_veiculo: 'Automóvel',
      marca: 'VW/Gol',
      cor: 'Prata',
      placa: 'ABC1234',
      ano_fabricacao: 2018,
      ano_modelo: 2019,
      natureza_apurada: 'Roubo',
    });
  });

  it('keeps numeric record fields typed when raw source values are text', () => {
    const config = SOURCE_TABLE_CONFIGS.find(
      (sourceConfig) =>
        sourceConfig.tablePattern === 'produtividade_entorpecentes'
    );

    const record = config?.extractRecord(
      {
        id: '42',
        QTDE_GRAMAS_ARRED: '1.234,56',
      },
      'produtividade_entorpecentes_2026'
    );

    expect(record).toMatchObject({
      source_id: 42,
      quantidade_gramas: 1234.56,
    });
  });
});
