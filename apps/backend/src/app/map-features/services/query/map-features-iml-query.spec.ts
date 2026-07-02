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

  it('normalizes BO and police unit lookup values', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
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
