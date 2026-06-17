import {
  parseGroupedOccurrence,
  parseMapFeatureResponse,
} from './map-feature-response.schema';

describe('map feature response schemas', () => {
  it('accepts grouped occurrence responses used by popups', () => {
    expect(
      parseGroupedOccurrence({
        numBo: '123',
        anoBo: 2026,
        latitude: -23.5,
        longitude: -46.6,
        primaryCategory: 'Furto',
        allCategories: ['Furto'],
        recordCount: 1,
        sourceTables: ['dados_criminais_2026'],
        occurrences: [
          {
            id: 'row-1',
            sourceTable: 'dados_criminais_2026',
            numBo: '123',
            anoBo: 2026,
            category: 'Furto',
            rubricaForStyling: 'Furto',
            latitude: -23.5,
            longitude: -46.6,
            dataOcorrencia: '2026-01-01',
            horaOcorrencia: null,
            dataRegistro: null,
            logradouro: null,
            numeroLogradouro: null,
            bairro: null,
            cidade: null,
            localTipo: null,
            periodo: null,
            conduta: null,
            naturezaApurada: null,
            delegacia: null,
          },
        ],
      })
    )?.toMatchObject({
      numBo: '123',
      recordCount: 1,
    });
  });

  it('rejects feature detail responses without feature data', () => {
    expect(() =>
      parseMapFeatureResponse({
        id: 'feature-1',
        numBo: '123',
        anoBo: 2026,
      })
    ).toThrow();
  });
});

