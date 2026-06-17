import { Injectable, Logger } from '@nestjs/common';
import type {
  FileMetadata as PrismaFileMetadata,
  ImlFileMetadata as PrismaImlFileMetadata,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FileMetadata, ImlFileMetadata } from '../types/data-import.types';
@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);

  constructor(private readonly prisma: PrismaService) {}
  async getFileMetadata(
    category: string,
    year: number
  ): Promise<FileMetadata | null> {
    const metadata = await this.prisma.fileMetadata.findUnique({
      where: {
        category_year: {
          category,
          year,
        },
      },
    });

    return metadata ? this.mapFileMetadata(metadata) : null;
  }
  async saveFileMetadata(metadata: FileMetadata): Promise<void> {
    await this.prisma.fileMetadata.upsert({
      where: {
        category_year: {
          category: metadata.category,
          year: metadata.year,
        },
      },
      update: {
        file_url: metadata.fileUrl,
        file_hash: metadata.fileHash,
        file_size: BigInt(metadata.fileSize),
        last_downloaded: metadata.lastDownloaded,
        last_imported: metadata.lastImported ?? null,
        record_count: metadata.recordCount,
      },
      create: {
        category: metadata.category,
        year: metadata.year,
        file_url: metadata.fileUrl,
        file_hash: metadata.fileHash,
        file_size: BigInt(metadata.fileSize),
        last_downloaded: metadata.lastDownloaded,
        last_imported: metadata.lastImported ?? null,
        record_count: metadata.recordCount,
      },
    });
  }
  async getImlFileMetadata(
    category: string,
    year: number,
    month: number
  ): Promise<ImlFileMetadata | null> {
    const metadata = await this.prisma.imlFileMetadata.findUnique({
      where: {
        category_year_month: {
          category,
          year,
          month,
        },
      },
    });

    return metadata ? this.mapImlFileMetadata(metadata) : null;
  }
  async getImlFileMetadataByYear(
    category: string,
    year: number
  ): Promise<ImlFileMetadata[]> {
    const result = await this.prisma.imlFileMetadata.findMany({
      where: { category, year },
      orderBy: { month: 'asc' },
    });

    return result.map((row) => this.mapImlFileMetadata(row));
  }
  async saveImlFileMetadata(metadata: ImlFileMetadata): Promise<void> {
    await this.prisma.imlFileMetadata.upsert({
      where: {
        category_year_month: {
          category: metadata.category,
          year: metadata.year,
          month: metadata.month,
        },
      },
      update: {
        file_url: metadata.fileUrl,
        file_hash: metadata.fileHash,
        file_size: BigInt(metadata.fileSize),
        last_downloaded: metadata.lastDownloaded,
        last_imported: metadata.lastImported ?? null,
        record_count: metadata.recordCount,
      },
      create: {
        category: metadata.category,
        year: metadata.year,
        month: metadata.month,
        file_url: metadata.fileUrl,
        file_hash: metadata.fileHash,
        file_size: BigInt(metadata.fileSize),
        last_downloaded: metadata.lastDownloaded,
        last_imported: metadata.lastImported ?? null,
        record_count: metadata.recordCount,
      },
    });
  }
  async getFileMetadataByCategory(category: string): Promise<FileMetadata[]> {
    const result = await this.prisma.fileMetadata.findMany({
      where: { category },
      orderBy: { year: 'desc' },
    });

    return result.map((row) => this.mapFileMetadata(row));
  }
  async deleteFileMetadata(category: string, year: number): Promise<void> {
    await this.prisma.fileMetadata.deleteMany({
      where: { category, year },
    });
  }
  async getFilesNeedingCheck(
    maxDaysOld: number
  ): Promise<
    Array<{ category: string; year: number; metadata: FileMetadata }>
  > {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxDaysOld);

    const result = await this.prisma.fileMetadata.findMany({
      where: {
        last_downloaded: {
          lt: cutoffDate,
        },
      },
      orderBy: [{ category: 'asc' }, { year: 'asc' }],
    });

    return result.map((row) => ({
      category: row.category,
      year: row.year,
      metadata: this.mapFileMetadata(row),
    }));
  }

  private mapFileMetadata(row: PrismaFileMetadata): FileMetadata {
    return {
      id: row.id,
      category: row.category,
      year: row.year,
      fileUrl: row.file_url,
      fileHash: row.file_hash,
      fileSize: Number(row.file_size ?? 0),
      lastDownloaded: row.last_downloaded,
      lastImported: row.last_imported ?? undefined,
      recordCount: row.record_count,
    };
  }
  private mapImlFileMetadata(row: PrismaImlFileMetadata): ImlFileMetadata {
    return {
      id: row.id,
      category: row.category,
      year: row.year,
      month: row.month,
      fileUrl: row.file_url,
      fileHash: row.file_hash,
      fileSize: Number(row.file_size ?? 0),
      lastDownloaded: row.last_downloaded,
      lastImported: row.last_imported ?? undefined,
      recordCount: row.record_count,
    };
  }
}
