import { PrismaService } from '../../../prisma/prisma.service';
import { MapFeature } from '../../types/map-features.types';
import { MapFeaturesSourceRecordHydrator } from './map-features-source-record-hydrator';

function createFeature(): MapFeature {
  return {
    id: '019eb505-9731-77d6-857f-56e4b1d9ccb7',
    num_bo: 'DU3509',
    ano_bo: 2026,
    delegacia: 'DEL.POL.METROPOLITANO',
    latitude: -23.551201,
    longitude: -46.634047,
    location_hash: 'f4693e770c96dabb',
    geom: null,
    category: 'Roubo (art. 157)',
    rubrica_for_styling: 'Roubo (art. 157)',
    data_ocorrencia: new Date('2026-01-01T00:00:00.000Z'),
    source_tables: ['dados_criminais_2026', 'celulares_2026'],
    feature_data: {
      location: {},
      occurrence: {},
      all_rubricas: ['Roubo (art. 157)'],
      records: [
        {
          type: 'dados_criminais',
          source_id: 181952,
          source_table: 'dados_criminais_2026',
          rubrica: 'Roubo (art. 157)',
        },
      ],
      summary: {
        total_records: 1,
        celulares_count: 0,
        veiculos_count: 0,
        objetos_count: 0,
        dados_criminais_count: 1,
        produtividade_count: 0,
      },
    },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('MapFeaturesSourceRecordHydrator', () => {
  it('returns the original feature when hydration is disabled', async () => {
    const queryRawUnsafe = jest.fn();
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const hydrator = new MapFeaturesSourceRecordHydrator(prisma, false);
    const feature = createFeature();

    await expect(hydrator.hydrate(feature)).resolves.toBe(feature);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('hydrates missing records from configured raw source tables', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        id: 55553,
        NUM_BO: 'DU3509',
        ANO_BO: 2026,
        NOME_DELEGACIA: 'DEL.POL.METROPOLITANO',
        LATITUDE: '-23.551201401',
        LONGITUDE: '-46.634046855',
        RUBRICA: 'Roubo (art. 157)',
        DESCR_TIPO_OBJETO: 'Telecomunicação',
        DESCR_SUBTIPO_OBJETO: 'Telefone Celular',
        MARCA_OBJETO: 'Samsung',
        QUANTIDADE_OBJETO: 1,
      },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const hydrator = new MapFeaturesSourceRecordHydrator(prisma, true);

    const hydrated = await hydrator.hydrate(createFeature());

    expect(hydrated.feature_data.records.map((record) => record.type)).toEqual([
      'dados_criminais',
      'celular',
    ]);
    expect(hydrated.feature_data.summary).toMatchObject({
      total_records: 2,
      celulares_count: 1,
      dados_criminais_count: 1,
    });
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FROM "raw"."celulares_2026"'),
      'DU3509',
      2026,
      'DEL.POL.METROPOLITANO',
      -23.551201,
      -46.634047
    );
  });
});
