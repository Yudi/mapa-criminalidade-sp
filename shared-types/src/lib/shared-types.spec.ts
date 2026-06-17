import {
  BoletimOcorrencia,
  DataFormValues,
  LocationQueryParams,
} from './shared-types';

describe('SharedTypes', () => {
  it('should define BoletimOcorrencia interface', () => {
    const boletim: BoletimOcorrencia = {
      id: 1,
      nome_departamento: 'Test Department',
      nome_seccional: null,
      nome_delegacia: null,
      cidade: 'São Paulo',
      ano_bo: 2023,
      num_bo: '123456',
      data_registro: '2023-01-01',
      data_ocorrencia_bo: '2023-01-01',
      hora_ocorrencia_bo: '10:00',
      descr_periodo: null,
      descr_subtipolocal: null,
      bairro: 'Centro',
      logradouro: 'Rua Test',
      numero_logradouro: '123',
      latitude: -23.5505,
      longitude: -46.6333,
      nome_delegacia_circunscricao: null,
      nome_departamento_circunscricao: null,
      nome_seccional_circunscricao: null,
      nome_municipio_circunscricao: null,
      rubrica: 'FURTO',
      descr_conduta: null,
      natureza_apurada: null,
      mes_estatistica: 1,
      ano_estatistica: 2023,
      location: {
        type: 'Point',
        coordinates: [-46.6333, -23.5505],
      },
    };

    expect(boletim.id).toBe(1);
    expect(boletim.cidade).toBe('São Paulo');
  });

  it('should define DataFormValues interface', () => {
    const formData: DataFormValues = {
      beforeDate: '2023-12-31',
      afterDate: '2023-01-01',
      street: 'Rua Test',
      city: 'São Paulo',
      state: 'SP',
    };

    expect(formData.city).toBe('São Paulo');
    expect(formData.beforeDate).toBe('2023-12-31');
  });

  it('should define LocationQueryParams interface', () => {
    const queryParams: LocationQueryParams = {
      lon: -46.6333,
      lat: -23.5505,
      radius: 500,
      before: '2023-12-31',
      after: '2023-01-01',
    };

    expect(queryParams.lat).toBe(-23.5505);
    expect(queryParams.lon).toBe(-46.6333);
  });
});
