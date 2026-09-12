import { DataCategoryConfig } from './config/data-category.config';
import { DataImportService } from './data-import-orchestrator.service';
import { FileOperationsService } from './services/file-operations.service';
import { ImlImportService } from './services/iml-import.service';
import { ImportDecisionService } from './services/import-decision.service';
import { ImportStatusService } from './services/import-status.service';
import { MetadataService } from './services/metadata.service';
import { ParquetProcessingService } from './services/parquet-processing.service';
import { RustToolService } from './services/rust-tool.service';
import { DataCategory } from './types/data-import.types';

describe('DataImportService orchestration', () => {
  const category: DataCategory = {
    name: 'Dados Criminais',
    baseUrl: 'https://example.com/source_',
    years: [2026],
    tablePrefix: 'dados_criminais',
    hasSchema: true,
  };

  function createService(): {
    service: DataImportService;
    imlImportService: jest.Mocked<
      Pick<ImlImportService, 'importWithIntelligentLogic'>
    >;
    fileOperationsService: Pick<
      FileOperationsService,
      'ensureDirectory' | 'cleanup'
    >;
    importDecisionService: Pick<ImportDecisionService, 'checkMultipleYears'>;
  } {
    const fileOperationsService = {
      ensureDirectory: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      sweepStaleDirectories: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileOperationsService;
    const rustToolService = {
      ensureRustTool: jest.fn().mockResolvedValue(undefined),
    } as unknown as RustToolService;
    const importDecisionService = {
      checkMultipleYears: jest
        .fn()
        .mockResolvedValue([
          { year: 2026, shouldImport: true, reason: 'changed' },
        ]),
    } as unknown as ImportDecisionService;
    const imlImportService = {
      importWithIntelligentLogic: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new DataImportService(
        fileOperationsService,
        rustToolService,
        {} as MetadataService,
        {} as ParquetProcessingService,
        importDecisionService,
        {} as ImportStatusService,
        imlImportService as unknown as ImlImportService
      ),
      imlImportService,
      fileOperationsService,
      importDecisionService,
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a failed external source group retryable', async () => {
    jest
      .spyOn(DataCategoryConfig, 'getDirectCategories')
      .mockReturnValue([category]);
    const { service, imlImportService } = createService();
    jest
      .spyOn(
        service as unknown as {
          importFromSingleFile(): Promise<void>;
        },
        'importFromSingleFile'
      )
      .mockRejectedValue(new Error('conversion failed'));

    await expect(service.importAllCategories()).rejects.toThrow(
      'Data import completed partially'
    );
    expect(imlImportService.importWithIntelligentLogic).toHaveBeenCalledTimes(
      1
    );
  });

  it('imports healthy categories and years before reporting unavailable sources', async () => {
    const unavailable = {
      ...category,
      name: 'Unavailable',
      years: [2025, 2026],
    };
    const broken = { ...category, name: 'Broken' };
    jest
      .spyOn(DataCategoryConfig, 'getDirectCategories')
      .mockReturnValue([unavailable, broken, category]);
    const { service, importDecisionService, imlImportService } =
      createService();
    jest
      .mocked(importDecisionService.checkMultipleYears)
      .mockImplementation(async (source) => {
        if (source === broken) throw new Error('verification failed');
        if (source === unavailable)
          return [
            { year: 2025, shouldImport: true, reason: 'changed' },
            {
              year: 2026,
              shouldImport: false,
              reason: 'timeout',
              retryable: true,
            },
          ];
        return [{ year: 2026, shouldImport: true, reason: 'changed' }];
      });
    const importFile = jest
      .spyOn(
        service as unknown as {
          importFromSingleFile(): Promise<void>;
        },
        'importFromSingleFile'
      )
      .mockResolvedValue(undefined);

    await expect(service.importAllCategories()).rejects.toThrow(
      'Data import completed partially'
    );

    expect(importFile).toHaveBeenCalledTimes(2);
    expect(importFile).toHaveBeenCalledWith(
      DataCategoryConfig.getUrl(unavailable, 2025),
      2025,
      [unavailable],
      expect.any(Function),
      undefined
    );
    expect(importFile).toHaveBeenCalledWith(
      DataCategoryConfig.getUrl(category, 2026),
      2026,
      [category],
      expect.any(Function),
      undefined
    );
    expect(imlImportService.importWithIntelligentLogic).toHaveBeenCalledTimes(
      1
    );
  });

  it('treats a low-priority IML source failure as non-fatal', async () => {
    jest.spyOn(DataCategoryConfig, 'getDirectCategories').mockReturnValue([]);
    const { service, imlImportService } = createService();
    imlImportService.importWithIntelligentLogic.mockRejectedValue(
      new Error('IML unavailable')
    );

    await expect(service.importAllCategories()).resolves.toBeUndefined();
  });

  it('reuses the payload downloaded during the import decision', async () => {
    jest
      .spyOn(DataCategoryConfig, 'getDirectCategories')
      .mockReturnValue([category]);
    const { service, importDecisionService, fileOperationsService } =
      createService();
    const sourceUrl = DataCategoryConfig.getUrl(category, 2026);
    jest
      .mocked(importDecisionService.checkMultipleYears)
      .mockImplementation(async (_category, cache) => {
        cache?.set(
          sourceUrl,
          Promise.resolve({
            hash: 'verified-hash',
            size: 123,
            filePath: '/tmp/verified-source.xlsx',
          })
        );
        return [{ year: 2026, shouldImport: true, reason: 'changed' }];
      });
    const importFromSingleFile = jest
      .spyOn(
        service as unknown as {
          importFromSingleFile(): Promise<void>;
        },
        'importFromSingleFile'
      )
      .mockResolvedValue(undefined);

    await service.importAllCategories();

    expect(importFromSingleFile).toHaveBeenCalledWith(
      sourceUrl,
      2026,
      [category],
      expect.any(Function),
      {
        hash: 'verified-hash',
        size: 123,
        filePath: '/tmp/verified-source.xlsx',
      }
    );
    expect(fileOperationsService.cleanup).toHaveBeenCalledWith(
      '/tmp/verified-source.xlsx'
    );
  });
});
