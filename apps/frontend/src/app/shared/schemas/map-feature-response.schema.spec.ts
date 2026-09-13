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

  it('accepts detail selections without unused identifiers or summary totals', () => {
    const detail = {
      imlUnavailable: false,
      dataOcorrencia: '2026-01-01',
      featureData: {
        location: { logradouro: 'Rua de teste', tipo_local: 'Via pública' },
        occurrence: { delegacia: 'Delegacia de registro' },
        all_rubricas: ['Furto'],
        records: [{ type: 'celular', source_id: 1, source_table: 'celulares_2026', marca: 'Marca' }],
      },
      imlRecords: [{
        sourceId: 1, sourceTable: 'iml_2026', dataEntradaIml: null,
        delegaciaRegistro: null, numeroLaudo: null, anoLaudo: null,
        idadeVitima: null, tipoIdade: null, conclusao: null,
        declaracaoObito: null, causaMortis: null,
      }],
    };
    expect(parseMapFeatureResponse(detail)).toEqual(detail);
    expect(() => parseMapFeatureResponse({ ...detail, imlUnavailable: 'false' })).toThrow();
  });

  it('accepts popup selections without unused source and coordinate fields', () => {
    const group = {
      numBo: '123', anoBo: 2026, primaryCategory: 'Furto',
      occurrences: [{
        dataOcorrencia: null, horaOcorrencia: null, dataRegistro: null,
        logradouro: null, numeroLogradouro: null, bairro: null, cidade: null,
        localTipo: null, conduta: null, naturezaApurada: null,
      }],
    };
    expect(parseGroupedOccurrence(group)).toEqual(group);
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
