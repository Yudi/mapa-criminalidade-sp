import { PrismaService } from '../../../prisma/prisma.service';
import { getImlRecordsByBo } from './map-features-iml-query';

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
});
