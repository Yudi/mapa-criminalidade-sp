import type {
  CensusAreaDetail,
  CensusIndicator,
} from '@mapa-criminalidade/shared-types';

// Fictional fixtures only. Names, boundaries and values do not describe real areas.
function indicator(
  key: string,
  group: string,
  label: string,
  value: number | null,
  denominator: number | null = null,
  unit = 'count'
): CensusIndicator {
  return {
    key,
    group,
    label,
    value,
    denominator,
    unit,
    sourceUrl: 'https://www.ibge.gov.br/',
    variables: 'Demonstração',
    universe: null,
  };
}

export const censusStoryArea: CensusAreaDetail = {
  releaseId: 'storybook-2022',
  code: '3507100013',
  level: 'neighborhood',
  name: 'Bairro de demonstração',
  municipalityName: 'Município de demonstração',
  year: 2022,
  population: 20000,
  areaKm2: 3.5,
  bounds: [-46.64, -23.555, -46.632, -23.545],
  indicators: [
    indicator('population', 'População', 'População residente', 20000),
    indicator('men', 'Demografia', 'Sexo masculino', 9600, 20000),
    indicator('women', 'Demografia', 'Sexo feminino', 10400, 20000),
    indicator('children', 'Demografia', '0 a 14 anos', 4000, 20000),
    indicator('youth', 'Demografia', '15 a 29 anos', 4800, 20000),
    indicator('olderAdults', 'Demografia', '60 anos ou mais', 3200, 20000),
    indicator(
      'literate',
      'Alfabetização',
      'Alfabetizadas - 15 anos ou mais',
      14800,
      16000
    ),
    indicator('white', 'Cor ou raça', 'Branca', 9800, 20000),
    indicator('black', 'Cor ou raça', 'Preta', 2400, 20000),
    indicator('asian', 'Cor ou raça', 'Amarela', 400, 20000),
    indicator('mixed', 'Cor ou raça', 'Parda', 7200, 20000),
    indicator('indigenous', 'Cor ou raça', 'Indígena', 200, 20000),
    indicator('households', 'Domicílios', 'Total de domicílios', 7000),
    indicator(
      'occupiedHouseholds',
      'Domicílios',
      'Particulares ocupados',
      6200
    ),
    indicator('vacantHouseholds', 'Domicílios', 'Permanentes vagos', 500),
    indicator(
      'residentsPerHousehold',
      'Domicílios',
      'Moradores por domicílio ocupado',
      3.2,
      null,
      'decimal'
    ),
    indicator(
      'permanentHouseholds',
      'Domicílios',
      'Permanentes ocupados',
      6100
    ),
    indicator('apartments', 'Domicílios', 'Apartamentos ocupados', 1800, 6100),
    indicator('waterNetwork', 'Saneamento', 'Rede geral de água', 5800),
    indicator('sewageNetwork', 'Saneamento', 'Rede de esgoto ou pluvial', 5500),
    indicator(
      'wasteCollection',
      'Saneamento',
      'Coleta domiciliar de lixo',
      5900
    ),
    indicator(
      'responsibleIncomeMean',
      'Renda',
      'Renda nominal média mensal',
      2450.5,
      null,
      'BRL'
    ),
    indicator(
      'responsibleIncomeMedian',
      'Renda',
      'Renda nominal mediana mensal',
      2100,
      null,
      'BRL'
    ),
  ],
};

export const censusStoryMunicipality: CensusAreaDetail = {
  ...censusStoryArea,
  code: '3507100',
  level: 'municipality',
  name: 'Município de demonstração',
  population: 40000,
  areaKm2: 7,
  bounds: [-46.64, -23.555, -46.624, -23.545],
  indicators: [
    ...censusStoryArea.indicators.map((item) => ({
      ...item,
      value:
        item.unit === 'count' && item.value !== null
          ? item.value * 2
          : item.value,
      denominator: item.denominator !== null ? item.denominator * 2 : null,
    })),
    indicator(
      'education9493',
      'Escolaridade - 18 anos ou mais',
      'Sem instrução e fundamental incompleto',
      6000,
      30000
    ),
    indicator(
      'education9494',
      'Escolaridade - 18 anos ou mais',
      'Fundamental completo e médio incompleto',
      6000,
      30000
    ),
    indicator(
      'education9495',
      'Escolaridade - 18 anos ou mais',
      'Médio completo e superior incompleto',
      12000,
      30000
    ),
    indicator(
      'education99713',
      'Escolaridade - 18 anos ou mais',
      'Superior completo',
      6000,
      30000
    ),
  ],
};

export const censusStoryMissingIncome: CensusAreaDetail = {
  ...censusStoryArea,
  code: '3507100014',
  name: 'Bairro sem renda divulgada',
  bounds: [-46.632, -23.555, -46.624, -23.545],
  indicators: censusStoryArea.indicators.map((item) => ({
    ...item,
    value: item.group === 'Renda' ? null : item.value,
  })),
};
export const censusStoryAreas = [
  censusStoryMunicipality,
  censusStoryArea,
  censusStoryMissingIncome,
];
