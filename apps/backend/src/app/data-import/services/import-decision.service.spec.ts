import { DataCategory } from '../types/data-import.types';
import { DatabaseService } from './database.service';
import { FileOperationsService } from './file-operations.service';
import { ImportDecisionService } from './import-decision.service';
import { MetadataService } from './metadata.service';

describe('ImportDecisionService', () => {
  const category: DataCategory = {
    name: 'Dados Criminais',
    baseUrl: 'https://example.com/SPDadosCriminais_',
    years: [2025, 2026],
    tablePrefix: 'dados_criminais',
    hasSchema: true,
  };

  let fileOperationsService: FileOperationsService;
  let databaseService: DatabaseService;
  let metadataService: MetadataService;
  let service: ImportDecisionService;

  beforeEach(() => {
    fileOperationsService = {
      downloadAndHash: jest.fn().mockResolvedValue({
        hash: 'new-hash',
        size: 123,
      }),
    } as unknown as FileOperationsService;

    databaseService = {
      checkTableExists: jest.fn().mockResolvedValue(true),
      hasTableRows: jest.fn().mockResolvedValue(true),
    } as unknown as DatabaseService;

    metadataService = {
      getFileMetadata: jest.fn().mockResolvedValue({
        category: category.name,
        year: 2025,
        fileUrl: 'https://example.com/SPDadosCriminais_2025.xlsx',
        fileHash: 'old-hash',
        fileSize: 100,
        lastDownloaded: new Date('2025-12-01T00:00:00Z'),
        lastImported: new Date('2025-12-01T00:00:00Z'),
        recordCount: 10,
      }),
      saveFileMetadata: jest.fn().mockResolvedValue(undefined),
    } as unknown as MetadataService;

    service = new ImportDecisionService(
      fileOperationsService,
      databaseService,
      metadataService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not refresh previous-year data outside January and February when data exists', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));

    const decision = await service.shouldImportData(category, 2025);

    expect(decision).toEqual({
      shouldImport: false,
      reason: '2025 data already exists in database; historical refresh skipped',
    });
    expect(fileOperationsService.downloadAndHash).not.toHaveBeenCalled();
  });

  it('checks the previous year in January for delayed October to December reporting', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T12:00:00Z'));

    const decision = await service.shouldImportData(category, 2025);

    expect(decision).toEqual({
      shouldImport: true,
      reason: '2025 data has been updated (hash changed)',
    });
    expect(fileOperationsService.downloadAndHash).toHaveBeenCalledWith(
      'https://example.com/SPDadosCriminais_2025.xlsx'
    );
  });

  it('imports previous-year data when the database table is missing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
    jest.mocked(databaseService.checkTableExists).mockResolvedValue(false);

    const decision = await service.shouldImportData(category, 2025);

    expect(decision).toEqual({
      shouldImport: true,
      reason: 'Table dados_criminais_2025 does not exist',
    });
    expect(fileOperationsService.downloadAndHash).not.toHaveBeenCalled();
  });

  it('imports an empty table even when metadata reports existing records', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
    jest.mocked(databaseService.hasTableRows).mockResolvedValue(false);

    const decision = await service.shouldImportData(category, 2025);

    expect(decision).toEqual({
      shouldImport: true,
      reason: 'Table is empty',
    });
    expect(databaseService.hasTableRows).toHaveBeenCalledWith(
      'dados_criminais_2025'
    );
    expect(fileOperationsService.downloadAndHash).not.toHaveBeenCalled();
  });

  it('does not refresh previous-year data only because metadata is missing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
    jest.mocked(metadataService.getFileMetadata).mockResolvedValue(null);

    const decision = await service.shouldImportData(category, 2025);

    expect(decision).toEqual({
      shouldImport: false,
      reason:
        '2025 data already exists in database; skipping historical refresh despite missing metadata',
    });
    expect(fileOperationsService.downloadAndHash).not.toHaveBeenCalled();
  });

  it('reuses one file hash check for categories sharing a workbook URL', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const sharedCache = new Map();
    const sharedWorkbookCategory: DataCategory = {
      ...category,
      name: 'Produtividade - Armas',
      baseUrl: 'https://example.com/DadosProdutividade_',
      years: [2026],
    };
    const otherSheetCategory: DataCategory = {
      ...sharedWorkbookCategory,
      name: 'Produtividade - Veículos',
    };

    await service.shouldImportData(sharedWorkbookCategory, 2026, sharedCache);
    await service.shouldImportData(otherSheetCategory, 2026, sharedCache);

    expect(fileOperationsService.downloadAndHash).toHaveBeenCalledTimes(1);
  });
});
