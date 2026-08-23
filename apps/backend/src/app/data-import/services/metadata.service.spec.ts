import { PrismaService } from '../../prisma/prisma.service';
import { MetadataService } from './metadata.service';

describe('MetadataService', () => {
  it('maps persisted file metadata and preserves bigint file sizes', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: '019c0000-0000-7000-8000-000000000001',
      category: 'Dados Criminais',
      year: 2026,
      file_url: 'https://example.com/source.xlsx',
      file_hash: 'abc123',
      file_size: BigInt('4294967296'),
      last_downloaded: new Date('2026-08-23T12:00:00.000Z'),
      last_imported: new Date('2026-08-23T12:10:00.000Z'),
      record_count: 42,
      created_at: new Date('2026-08-23T12:00:00.000Z'),
      updated_at: new Date('2026-08-23T12:10:00.000Z'),
    });
    const service = new MetadataService({
      fileMetadata: { findUnique },
    } as unknown as PrismaService);

    await expect(
      service.getFileMetadata('Dados Criminais', 2026)
    ).resolves.toMatchObject({
      fileHash: 'abc123',
      fileSize: 4_294_967_296,
      recordCount: 42,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        category_year: { category: 'Dados Criminais', year: 2026 },
      },
    });
  });

  it('upserts metadata under the category/year identity', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const service = new MetadataService({
      fileMetadata: { upsert },
    } as unknown as PrismaService);
    const lastDownloaded = new Date('2026-08-23T12:00:00.000Z');

    await service.saveFileMetadata({
      category: 'Dados Criminais',
      year: 2026,
      fileUrl: 'https://example.com/source.xlsx',
      fileHash: 'abc123',
      fileSize: 123,
      lastDownloaded,
      recordCount: 42,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category_year: { category: 'Dados Criminais', year: 2026 },
        },
        update: expect.objectContaining({
          file_hash: 'abc123',
          file_size: BigInt(123),
          last_downloaded: lastDownloaded,
          record_count: 42,
        }),
      })
    );
  });
});
