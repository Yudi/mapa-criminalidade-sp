import { fakerPT_BR as faker } from '@faker-js/faker';
import {
  CategoryInfo,
  GroupedOccurrence,
  MapFeatureCharts,
  MapFeatureResponse,
  MapFeatureTemporalStats,
  PeriodInfo,
  WeekdayHourBucket,
} from '@mapa-criminalidade/shared-types';

faker.seed(20_260_912);

const fakeBoNumber = faker.string.numeric(8);
const fakeFeatureId = faker.string.uuid();

export const storyDateRange = {
  earliest: '2024-01-01',
  latest: '2026-08-31',
  defaultAfter: '2026-01-01',
} as const;

export const storyCategories: CategoryInfo[] = [
  {
    name: 'Furto',
    count: 1_284,
    rubricaForStyling: 'Furto',
    sourceType: 'rubrica',
  },
  {
    name: 'Roubo',
    count: 736,
    rubricaForStyling: 'Roubo',
    sourceType: 'rubrica',
  },
  {
    name: 'Estelionato',
    count: 318,
    rubricaForStyling: 'Estelionato',
    sourceType: 'rubrica',
  },
  {
    name: 'Veículos recuperados',
    count: 94,
    rubricaForStyling: 'Veículos Recuperados',
    sourceType: 'derived',
  },
];

export const storyPeriods: PeriodInfo[] = [
  { name: 'Pela manhã', count: 514 },
  { name: 'À tarde', count: 684 },
  { name: 'À noite', count: 903 },
  { name: 'De madrugada', count: 237 },
  { name: 'Em hora incerta', count: 94 },
];

export interface StoryMapFeature {
  featureId: string;
  numBo: string;
  anoBo: number;
  delegacia: string;
  category: string;
  coordinates: [number, number];
}

const mapFeatureSeeds: Array<
  Pick<StoryMapFeature, 'category' | 'coordinates'>
> = [
  { category: 'Furto', coordinates: [-46.63331, -23.55052] },
  { category: 'Furto', coordinates: [-46.63292, -23.55021] },
  { category: 'Roubo', coordinates: [-46.63401, -23.55089] },
  { category: 'Roubo', coordinates: [-46.63512, -23.54992] },
  { category: 'Estelionato', coordinates: [-46.63082, -23.55131] },
  { category: 'Veículos recuperados', coordinates: [-46.63811, -23.55211] },
];

export const storyMapFeatures: StoryMapFeature[] = mapFeatureSeeds.map(
  (feature) => ({
    ...feature,
    featureId: faker.string.uuid(),
    numBo: faker.string.numeric(8),
    anoBo: 2026,
    delegacia: 'Delegacia fictícia de demonstração',
  })
);

export const storyWeekdayHours: WeekdayHourBucket[] = [
  { weekday: 1, hour: 0, count: 4 },
  { weekday: 1, hour: 8, count: 18 },
  { weekday: 1, hour: 18, count: 44 },
  { weekday: 2, hour: 12, count: 27 },
  { weekday: 3, hour: 18, count: 62 },
  { weekday: 4, hour: 22, count: 35 },
  { weekday: 5, hour: 19, count: 78 },
  { weekday: 6, hour: 23, count: 53 },
  { weekday: 7, hour: 23, count: 29 },
  { weekday: 1, hour: null, count: 11 },
  { weekday: 6, hour: null, count: 7 },
  { weekday: null, hour: 12, count: 6 },
  { weekday: null, hour: null, count: 3 },
];

export const storyCharts: MapFeatureCharts = {
  totalFeatures: 2_432,
  totalRecords: 3_014,
  categoryDistribution: [
    { label: 'Furto', count: 1_284 },
    { label: 'Roubo', count: 736 },
    { label: 'Estelionato', count: 318 },
    { label: 'Veículos recuperados', count: 94 },
  ],
  periodDistribution: storyPeriods.map(({ name, count }) => ({
    label: name,
    count,
  })),
  weekdayDistribution: [
    'Segunda',
    'Terça',
    'Quarta',
    'Quinta',
    'Sexta',
    'Sábado',
    'Domingo',
  ].map((label, index) => ({
    label,
    filterValue: String(index + 1),
    count: 210 + index * 37,
  })),
  weekdayHourDistribution: storyWeekdayHours,
  recordTypeDistribution: [
    { label: 'Celulares', count: 924 },
    { label: 'Veículos', count: 587 },
    { label: 'Objetos', count: 463 },
    { label: 'Dados criminais', count: 412 },
    { label: 'Armas', count: 61 },
    { label: 'Entorpecentes', count: 42 },
    { label: 'Veículos recuperados', count: 94 },
    { label: 'Pessoas', count: 431 },
  ],
  objectTypeDistribution: [
    {
      label: 'Telefone celular',
      filterValue: 'TELEFONE CELULAR',
      count: 812,
      amount: 839,
    },
    { label: 'Carteira', filterValue: 'CARTEIRA', count: 244, amount: 251 },
    { label: 'Documento', filterValue: 'DOCUMENTO', count: 198, amount: 356 },
  ],
  vehicleBrandDistribution: [
    { label: 'Volkswagen', filterValue: 'VW', count: 184 },
    { label: 'Chevrolet', filterValue: 'GM/CHEVROLET', count: 146 },
    { label: 'Fiat', filterValue: 'FIAT', count: 121 },
  ],
  phoneBrandDistribution: [
    {
      label: 'Samsung · Galaxy',
      filterValue: 'Samsung · Galaxy',
      count: 288,
      amount: 302,
    },
    {
      label: 'Apple · iPhone',
      filterValue: 'Apple · iPhone',
      count: 224,
      amount: 231,
    },
    {
      label: 'Motorola · Moto G',
      filterValue: 'Motorola · Moto G',
      count: 157,
      amount: 163,
    },
  ],
  locationTypeDistribution: [
    { label: 'Via pública', filterValue: 'VIA PUBLICA', count: 1_112 },
    { label: 'Residência', filterValue: 'RESIDENCIA', count: 468 },
    { label: 'Comércio', filterValue: 'COMERCIO', count: 301 },
  ],
  policeCircumscriptionDistribution: [
    { label: '01º D.P. Sé', count: 312 },
    { label: '04º D.P. Consolação', count: 257 },
  ],
  policeUnitDistribution: [
    { label: 'Delegacia Eletrônica', count: 489 },
    { label: '78º D.P. Jardins', count: 212 },
  ],
  weaponTypeDistribution: [
    { label: 'Revólver · calibre .38', count: 27 },
    { label: 'Pistola · calibre 9 mm', count: 19 },
  ],
  drugTypeDistribution: [
    { label: 'Cocaína', count: 22, amount: 684.5 },
    { label: 'Maconha', count: 17, amount: 1_942 },
  ],
};

export const storyFeature: MapFeatureResponse = {
  id: fakeFeatureId,
  numBo: fakeBoNumber,
  anoBo: 2026,
  delegacia: 'Delegacia Eletrônica',
  latitude: -23.55052,
  longitude: -46.63331,
  category: 'Roubo',
  rubricaForStyling: 'Roubo',
  dataOcorrencia: '2026-08-17',
  sourceTables: [
    'celulares_2026',
    'veiculos_2026',
    'objetos_2026',
    'produtividade_2026',
  ],
  featureData: {
    location: {
      logradouro: faker.location.street(),
      numero: faker.location.buildingNumber(),
      bairro: 'Sé',
      cidade: 'São Paulo',
      cep: '01001-000',
      tipo_local: 'Via pública',
      subtipo_local: 'Calçada',
    },
    occurrence: {
      hora_ocorrencia: '18:35:00',
      periodo: 'À noite',
      delegacia: 'Delegacia Eletrônica',
      delegacia_circunscricao: '01º D.P. Sé',
      departamento: 'DECAP',
      natureza_apurada: 'Roubo consumado',
      conduta: 'Subtração mediante grave ameaça',
      autoria: 'Desconhecida',
      flagrante: false,
      data_registro: '2026-08-18',
      data_comunicacao: '2026-08-18',
    },
    all_rubricas: ['Roubo', 'Localização/Apreensão de veículo'],
    records: [
      {
        type: 'celular',
        source_id: 11,
        source_table: 'celulares_2026',
        rubrica: 'Roubo',
        descr_modo_objeto: 'Subtraído',
        descr_tipo_objeto: 'Telefone celular',
        descr_subtipo_objeto: 'Smartphone',
        marca: 'Samsung',
        quantidade: 1,
        bloqueio: true,
        desbloqueio: false,
      },
      {
        type: 'veiculo',
        source_id: 12,
        source_table: 'veiculos_2026',
        rubrica: 'Roubo',
        descr_ocorrencia: 'Subtraído',
        tipo_veiculo: 'Automóvel',
        marca: 'Volkswagen',
        cor: 'Prata',
        placa: 'ABC1D23',
        ano_fabricacao: 2022,
        ano_modelo: 2023,
      },
      {
        type: 'objeto',
        source_id: 13,
        source_table: 'objetos_2026',
        rubrica: 'Roubo',
        descr_modo_objeto: 'Subtraído',
        descr_tipo_objeto: 'Carteira',
        descr_subtipo_objeto: 'Documentos pessoais',
        marca: 'Sem marca',
        quantidade: 1,
      },
      {
        type: 'dados_criminais',
        source_id: 14,
        source_table: 'dados_criminais_2026',
        rubrica: 'Roubo',
        natureza_apurada: 'Roubo consumado',
        conduta: 'Grave ameaça',
      },
      {
        type: 'produtividade_armas',
        source_id: 15,
        source_table: 'produtividade_armas_2026',
        tipo_arma: 'Revólver',
        marca: 'Marca não informada',
        calibre: '.38',
        descr_modo_objeto: 'Apreendido',
        descricao_apresentacao: 'Apreensão em flagrante',
        natureza_apurada: 'Porte ilegal de arma',
      },
      {
        type: 'produtividade_entorpecentes',
        source_id: 16,
        source_table: 'produtividade_entorpecentes_2026',
        tipo_droga: 'Cocaína',
        quantidade_gramas: 42.5,
        descricao_apresentacao: 'Apreendido',
        natureza_apurada: 'Tráfico de drogas',
      },
      {
        type: 'produtividade_veiculos',
        source_id: 17,
        source_table: 'produtividade_veiculos_2026',
        descr_ocorrencia: 'Localizado',
        tipo_veiculo: 'Motocicleta',
        marca: 'Honda',
        cor: 'Vermelha',
        placa: 'EFG4H56',
        ano_fabricacao: 2021,
        ano_modelo: 2021,
        descricao_apresentacao: 'Veículo recuperado',
        natureza_apurada: 'Localização e apreensão',
      },
      {
        type: 'produtividade_pessoa',
        source_id: 18,
        source_table: 'produtividade_pessoas_2026',
        tipo_pessoa: 'Autor identificado',
        sexo: 'Masculino',
        idade: 31,
        cor: 'Parda',
        profissao: 'Não informada',
        grau_instrucao: 'Ensino médio',
        nacionalidade: 'Brasileira',
        descricao_apresentacao: 'Preso em flagrante',
        natureza_apurada: 'Roubo consumado',
      },
    ],
    summary: {
      total_records: 8,
      celulares_count: 1,
      veiculos_count: 1,
      objetos_count: 1,
      dados_criminais_count: 1,
      produtividade_count: 4,
    },
  },
  imlRecords: [
    {
      sourceId: 19,
      sourceTable: 'iml_2026',
      dataEntradaIml: '18/08/2026 09:15:00',
      anoBo: '2026',
      numBo: fakeBoNumber,
      delegaciaRegistro: '01º D.P. Sé',
      numeroLaudo: '000123',
      anoLaudo: '2026',
      idadeVitima: '34',
      tipoIdade: 'anos',
      conclusao: 'Exame concluído',
      declaracaoObito: 'DO fictícia 0001',
      causaMortis: 'Informação fictícia para demonstração',
    },
  ],
};

const createOccurrence = (
  id: string,
  category: string,
  overrides: Partial<GroupedOccurrence['occurrences'][number]> = {}
): GroupedOccurrence['occurrences'][number] => ({
  id,
  sourceTable: 'dados_criminais_2026',
  numBo: fakeBoNumber,
  anoBo: 2026,
  category,
  rubricaForStyling: category,
  latitude: -23.55052,
  longitude: -46.63331,
  dataOcorrencia: '2026-08-17',
  horaOcorrencia: '18:35',
  dataRegistro: '2026-08-18',
  logradouro: storyFeature.featureData.location.logradouro ?? null,
  numeroLogradouro: storyFeature.featureData.location.numero ?? null,
  bairro: 'Sé',
  cidade: 'São Paulo',
  localTipo: 'Via pública',
  periodo: 'À noite',
  conduta: 'Subtração mediante grave ameaça',
  naturezaApurada: 'Roubo consumado',
  delegacia: 'Delegacia Eletrônica',
  ...overrides,
});

export const storyGroupedOccurrences: GroupedOccurrence[] = [
  {
    numBo: fakeBoNumber,
    anoBo: 2026,
    latitude: -23.55052,
    longitude: -46.63331,
    primaryCategory: 'Roubo',
    allCategories: ['Roubo', 'Ameaça'],
    recordCount: 2,
    sourceTables: ['dados_criminais_2026', 'celulares_2026'],
    occurrences: [
      createOccurrence('occurrence-1', 'Roubo'),
      createOccurrence('occurrence-2', 'Ameaça', {
        naturezaApurada: 'Ameaça consumada',
        conduta: 'Ameaça verbal',
        horaOcorrencia: null,
      }),
    ],
  },
  {
    numBo: faker.string.numeric(8),
    anoBo: 2026,
    latitude: -23.5489,
    longitude: -46.6388,
    primaryCategory: 'Furto',
    allCategories: ['Furto'],
    recordCount: 1,
    sourceTables: ['objetos_2026'],
    occurrences: [
      createOccurrence('occurrence-3', 'Furto', {
        numBo: faker.string.numeric(8),
        naturezaApurada: 'Furto consumado',
        conduta: null,
      }),
    ],
  },
];

export const storyTemporalTrend: MapFeatureTemporalStats = {
  datasetRevision: 'storybook-2026-09-12',
  total: 671,
  monthly: [
    { label: '2026-01', count: 82 },
    { label: '2026-02', count: 71 },
    { label: '2026-03', count: 0 },
    { label: '2026-04', count: 93 },
    { label: '2026-05', count: 106 },
    { label: '2026-06', count: 118 },
    { label: '2026-07', count: 124 },
    { label: '2026-08', count: 77 },
  ],
  categories: [
    { label: 'Furto', count: 348 },
    { label: 'Roubo', count: 211 },
    { label: 'Estelionato', count: 112 },
  ],
};

export const storyTemporalComparison = (
  current: boolean
): MapFeatureTemporalStats => ({
  datasetRevision: 'storybook-2026-09-12',
  total: current ? 248 : 221,
  monthly: [],
  categories: current
    ? [
        { label: 'Furto', count: 132 },
        { label: 'Roubo', count: 82 },
        { label: 'Estelionato', count: 34 },
      ]
    : [
        { label: 'Furto', count: 119 },
        { label: 'Roubo', count: 91 },
        { label: 'Dano', count: 11 },
      ],
});
