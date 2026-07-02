import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MapFeaturesVectorTileQuery } from './map-features-vector-tile-query';

describe('MapFeaturesVectorTileQuery', () => {
  it('generates tiles inside a read-only transaction', async () => {
    const tile = Buffer.from([1, 2, 3]);
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ mvt: tile }]);
    const transaction = jest
      .fn()
      .mockImplementation(async (operation) =>
        operation({
          $executeRawUnsafe: executeRawUnsafe,
          $queryRawUnsafe: queryRawUnsafe,
        })
      );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const tileQuery = new MapFeaturesVectorTileQuery(prisma);

    await expect(tileQuery.getTile({ z: 12, x: 100, y: 200 })).resolves.toEqual(
      {
        status: 'ok',
        tile,
      }
    );

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 30_000,
      timeout: 31_000,
    });
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'SET TRANSACTION READ ONLY'
    );
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SELECT public.occurrences'),
      12,
      100,
      200,
      '{}'
    );
  });

  it('returns a timeout result when Prisma cannot start the transaction', async () => {
    const transactionStartError = new Error(
      'Transaction API error: Unable to start a transaction in the given time.'
    );
    Object.setPrototypeOf(
      transactionStartError,
      Prisma.PrismaClientKnownRequestError.prototype
    );
    const transaction = jest.fn().mockRejectedValue(transactionStartError);
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const tileQuery = new MapFeaturesVectorTileQuery(prisma);

    await expect(tileQuery.getTile({ z: 12, x: 100, y: 200 })).resolves.toEqual(
      {
        status: 'timeout',
        tile: null,
      }
    );
  });
});
