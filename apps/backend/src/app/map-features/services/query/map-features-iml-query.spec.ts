import { PrismaService } from '../../../prisma/prisma.service';
import { getImlRecordsByBo } from './map-features-iml-query';

const baseImlRow = {
  source_id: 6406,
  source_table: 'registro_obitos_iml_2025',
  data_entrada_iml: '09/04/2025 07:56:00',
  ano_bo: '2025',
  num_bo: 'BQ4691',
  delegacia_registro: '24 D.P. - ERM. MATARAZZO',
  delegacia_registro_normalized: '24 D P ERM MATARAZZO',
  numero_laudo: 'report-1',
  ano_laudo: '2025',
  idade_vitima: '25',
  tipo_idade: 'ANOS',
  conclusao: '',
  declaracao_obito: 'synthetic-certificate',
  causa_mortis: 'Causa informada',
  map_delegacias: ['24º D.P. PONTE RASA'] as Array<string | null>,
};

function mockImlLookup(rows = [baseImlRow]) {
  const query = jest.fn().mockResolvedValue(rows);
  const prisma = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { table_name: 'registro_obitos_iml_2025' },
        { table_name: 'registro_obitos_iml_2026' },
        { table_name: 'registro_obitos_iml_tmp' },
      ]),
    $queryRawUnsafe: query,
  } as unknown as PrismaService;
  return { prisma, query };
}

describe('getImlRecordsByBo', () => {
  it('does not query raw IML tables without a police unit', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
    } as unknown as PrismaService;

    await expect(getImlRecordsByBo(prisma, '123', 2026, null)).resolves.toEqual(
      []
    );
  });

  it('orders valid calendar dates and preserves malformed raw dates without SQL casts', async () => {
    const rows = [
      {
        source_id: 1,
        source_table: 'registro_obitos_iml_2026',
        data_entrada_iml: '32/03/2026',
      },
      {
        source_id: 2,
        source_table: 'registro_obitos_iml_2026',
        data_entrada_iml: '02/03/2026 08:00',
      },
      {
        source_id: 3,
        source_table: 'registro_obitos_iml_2026',
        data_entrada_iml: '01/03/2026',
      },
      {
        source_id: 4,
        source_table: 'registro_obitos_iml_2026',
        data_entrada_iml: '01/03/2026 25:00',
      },
    ];
    const query = jest.fn().mockResolvedValue(rows);
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ table_name: 'registro_obitos_iml_2026' }]),
      $queryRawUnsafe: query,
    } as unknown as PrismaService;
    const result = await getImlRecordsByBo(prisma, 'BO-1', 2026, 'DP');
    expect(result.map((row) => row.sourceId)).toEqual([3, 2, 1, 4]);
    expect(result[2].dataEntradaIml).toBe('32/03/2026');
    expect(query.mock.calls[0][0]).not.toContain('to_timestamp');
  });

  it('normalizes BO and police unit lookup values', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([
        { table_name: 'registro_obitos_iml_2026' },
        { table_name: 'registro_obitos_iml_tmp' },
      ]);
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: queryRaw,
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;

    await getImlRecordsByBo(prisma, 'AB-123', 2026, '01º D.P. - Mauá');

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('registro_obitos_iml_2026'),
      'AB 123',
      '2026',
      '01 D P MAUA'
    );
    expect(queryRawUnsafe.mock.calls[0][0]).not.toContain(
      'registro_obitos_iml_tmp'
    );
  });

  it('recovers BQ4691/2025 and preserves both reports for the same death certificate', async () => {
    const { prisma, query } = mockImlLookup([
      {
        ...baseImlRow,
        source_id: 10688,
        data_entrada_iml: '10/06/2025 16:55:00',
      },
      baseImlRow,
    ]);

    const result = await getImlRecordsByBo(
      prisma,
      'BQ4691',
      2025,
      '24º D.P. PONTE RASA'
    );

    expect(result.map((row) => row.sourceId)).toEqual([6406, 10688]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0].slice(1)).toEqual(['BQ4691', '2025']);
    expect(query.mock.calls[0][0]).toContain('"ANO_BO" = $2');
    expect(query.mock.calls[0][0]).toContain('ano_bo = $2::integer');
    expect(query.mock.calls[0][0]).not.toContain('registro_obitos_iml_tmp');
  });

  it('matches editions across yearly IML tables and preserves their original identifiers', async () => {
    const { prisma, query } = mockImlLookup([
      { ...baseImlRow, num_bo: 'BQ4691-1' },
      {
        ...baseImlRow,
        source_id: 1,
        source_table: 'registro_obitos_iml_2026',
        num_bo: 'BQ4691-2',
        data_entrada_iml: '01/02/2026 08:00:00',
      },
    ]);

    const result = await getImlRecordsByBo(
      prisma,
      'bq4691-3',
      2025,
      '24º D.P. PONTE RASA'
    );

    expect(result.map((row) => row.numBo)).toEqual(['BQ4691-1', 'BQ4691-2']);
    expect(query.mock.calls[0].slice(1)).toEqual(['BQ4691', '2025']);
  });

  it('prefers exact unit matches across editions even when other unit groups exist', async () => {
    const exact = {
      ...baseImlRow,
      source_id: 2,
      num_bo: 'BQ4691-2',
      delegacia_registro: '24º D.P. PONTE RASA',
      delegacia_registro_normalized: '24 D P PONTE RASA',
      map_delegacias: ['24º D.P. PONTE RASA', 'OTHER UNIT'],
    };
    const { prisma } = mockImlLookup([baseImlRow, exact]);

    const result = await getImlRecordsByBo(
      prisma,
      'BQ4691',
      2025,
      '24º D.P. PONTE RASA'
    );

    expect(result.map((row) => row.sourceId)).toEqual([2]);
  });

  it('rejects conflicting IML units across editions instead of selecting the latest one', async () => {
    const { prisma } = mockImlLookup([
      baseImlRow,
      {
        ...baseImlRow,
        num_bo: 'BQ4691-2',
        delegacia_registro: 'OTHER UNIT',
        delegacia_registro_normalized: 'OTHER UNIT',
      },
    ]);

    await expect(
      getImlRecordsByBo(prisma, 'BQ4691', 2025, '24º D.P. PONTE RASA')
    ).resolves.toEqual([]);
  });

  it.each<{ mapUnits: Array<string | null> }>([
    { mapUnits: [] },
    { mapUnits: [null] },
    { mapUnits: ['24º D.P. PONTE RASA', null] },
    { mapUnits: ['24º D.P. PONTE RASA', 'OTHER UNIT'] },
    { mapUnits: ['OTHER UNIT'] },
  ])(
    'rejects missing or conflicting map units ($mapUnits)',
    async ({ mapUnits }) => {
      const { prisma } = mockImlLookup([
        { ...baseImlRow, map_delegacias: mapUnits },
      ]);

      await expect(
        getImlRecordsByBo(prisma, 'BQ4691', 2025, '24º D.P. PONTE RASA')
      ).resolves.toEqual([]);
    }
  );

  it('allows multiple locations and normalizes punctuation and accents in map units', async () => {
    const { prisma } = mockImlLookup([
      {
        ...baseImlRow,
        map_delegacias: [
          '24º D.P. PONTE RASA',
          '24 D P Ponte Rása',
          '24º D.P. PONTE RASA',
        ],
      },
    ]);

    await expect(
      getImlRecordsByBo(prisma, 'BQ4691', 2025, '24º D.P. PONTE RASA')
    ).resolves.toHaveLength(1);
  });

  it.each<[string, number]>([
    ['1', 2021],
    ['123', 2025],
    ['BQ4691-2', 2020],
    ['AA0000-1', 2025],
    ['BQ4691/2025', 2025],
  ])('keeps %s/%s on the indexed strict lookup', async (numBo, year) => {
    const { prisma, query } = mockImlLookup([]);

    await getImlRecordsByBo(prisma, numBo, year, 'DP');

    expect(query.mock.calls[0][0]).toContain('"NUM_BO_NORMALIZED" = $1');
    expect(query.mock.calls[0][0]).toContain(
      '"DELEGACIA_REGISTRO_NORMALIZED" = $3'
    );
    expect(query.mock.calls[0][0]).toContain('"NUM_BO_NORMALIZED" <> \'\'');
    expect(query.mock.calls[0][0]).toContain('"ANO_BO" <> \'\'');
    expect(query.mock.calls[0][0]).toContain(
      '"DELEGACIA_REGISTRO_NORMALIZED" <> \'\''
    );
    expect(query.mock.calls[0][0]).not.toContain('public.map_features');
    expect(query.mock.calls[0].slice(1)).toEqual([
      numBo.replace(/[^A-Z0-9]+/g, ' '),
      String(year),
      'DP',
    ]);
  });

  it('returns no rows when no IML tables are available', async () => {
    const { prisma, query } = mockImlLookup();
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    await expect(
      getImlRecordsByBo(prisma, 'BQ4691', 2025, '24º D.P. PONTE RASA')
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
