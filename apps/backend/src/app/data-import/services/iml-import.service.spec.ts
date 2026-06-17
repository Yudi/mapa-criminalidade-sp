import { DataCategory } from '../types/data-import.types';
import { CsvProcessingService } from './csv-processing.service';
import { DatabaseService } from './database.service';
import { FileOperationsService } from './file-operations.service';
import { ImlImportService } from './iml-import.service';
import { MetadataService } from './metadata.service';
import { PythonToolService } from './python-tool.service';

describe('ImlImportService', () => {
  const category: DataCategory = {
    name: 'Registro de Óbitos - IML',
    baseUrl: 'https://example.com/Consultas.aspx',
    years: [2026],
    tablePrefix: 'registro_obitos_iml',
    hasSchema: true,
    importStrategy: 'ssp-iml',
  };

  let pythonToolService: PythonToolService;
  let fileOperationsService: FileOperationsService;
  let csvProcessingService: CsvProcessingService;
  let databaseService: DatabaseService;
  let metadataService: MetadataService;
  let service: ImlImportService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T12:00:00Z'));

    pythonToolService = {
      runAssetScript: jest.fn().mockImplementation(
        (_scriptName: string, args: string[]) => {
          const year = Number(args[args.indexOf('--year') + 1]);
          const months = args[args.indexOf('--months') + 1]
            .split(',')
            .map(Number);
          return Promise.resolve({
            stdout: JSON.stringify({
              year,
              files: months.map((month) => ({
                month,
                recordCount: 10,
                outputPath: `/tmp/iml_${year}_${month}.csv`,
              })),
            }),
            stderr: '',
          });
        }
      ),
    } as unknown as PythonToolService;

    fileOperationsService = {
      ensureDirectory: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      calculateFileHash: jest
        .fn()
        .mockImplementation((filePath: string) =>
          Promise.resolve(`hash-${Number(filePath.match(/_(\d+)\.csv$/)?.[1])}`)
        ),
      getFileSize: jest.fn().mockResolvedValue(100),
    } as unknown as FileOperationsService;

    csvProcessingService = {
      importSingleCsvFileReplacingImlMonth: jest.fn().mockResolvedValue(10),
    } as unknown as CsvProcessingService;

    databaseService = {
      checkTableExists: jest.fn().mockResolvedValue(true),
      getImlImportedMonths: jest
        .fn()
        .mockResolvedValue(new Set([1, 2, 3, 4, 5, 6])),
      hasTableRows: jest.fn().mockResolvedValue(true),
      ensureImlLookupIndex: jest.fn().mockResolvedValue(undefined),
      markTableAsNonGeographic: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;

    metadataService = {
      getImlFileMetadataByYear: jest
        .fn()
        .mockImplementation((_category: string, year: number) =>
          Promise.resolve(
            Array.from({ length: year === 2026 ? 6 : 12 }, (_, index) =>
              createMetadata(year, index + 1)
            )
          )
        ),
      getImlFileMetadata: jest
        .fn()
        .mockImplementation((_category: string, year: number, month: number) =>
          Promise.resolve(createMetadata(year, month))
        ),
      saveImlFileMetadata: jest.fn().mockResolvedValue(undefined),
    } as unknown as MetadataService;

    service = new ImlImportService(
      pythonToolService,
      fileOperationsService,
      csvProcessingService,
      databaseService,
      metadataService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('checks the current and two previous months when history and metadata are complete', async () => {
    await service.importCategory(category);

    expect(getScraperMonths()).toEqual(['4,5,6']);
    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).not.toHaveBeenCalled();
    expect(metadataService.saveImlFileMetadata).toHaveBeenCalledTimes(3);
  });

  it('downloads missing historical months and rebuilds them even when the stored hash matches', async () => {
    jest
      .mocked(databaseService.getImlImportedMonths)
      .mockResolvedValue(new Set([1, 2, 4, 5, 6]));

    await service.importCategory(category);

    expect(getScraperMonths()).toEqual(['3,4,5,6']);
    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).toHaveBeenCalledTimes(1);
    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).toHaveBeenCalledWith('/tmp/iml_2026_3.csv', category, 2026, 3);
  });

  it('processes a scheduled month only when its hash changed', async () => {
    jest
      .mocked(fileOperationsService.calculateFileHash)
      .mockImplementation((filePath: string) => {
        const month = Number(filePath.match(/_(\d+)\.csv$/)?.[1]);
        return Promise.resolve(month === 5 ? 'changed-hash' : `hash-${month}`);
      });

    await service.importCategory(category);

    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).toHaveBeenCalledTimes(1);
    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).toHaveBeenCalledWith('/tmp/iml_2026_5.csv', category, 2026, 5);
  });

  it('imports successful scraper files before reporting missing months', async () => {
    jest.mocked(pythonToolService.runAssetScript).mockResolvedValue({
      stdout: JSON.stringify({
        year: 2026,
        files: [
          {
            month: 4,
            recordCount: 10,
            outputPath: '/tmp/iml_2026_4.csv',
          },
        ],
      }),
      stderr: 'Failed to download 2026-05: request timed out',
    });
    jest
      .mocked(fileOperationsService.calculateFileHash)
      .mockResolvedValue('changed-hash');

    await expect(service.importCategory(category)).rejects.toThrow(
      'Scraper did not return 2026-05'
    );

    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).toHaveBeenCalledTimes(1);
    expect(
      csvProcessingService.importSingleCsvFileReplacingImlMonth
    ).toHaveBeenCalledWith('/tmp/iml_2026_4.csv', category, 2026, 4);
  });

  it('extends IML into the current year without requesting future months', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-14T12:00:00Z'));
    const olderCategory = { ...category, years: [2025] };
    jest
      .mocked(databaseService.getImlImportedMonths)
      .mockImplementation((tableName: string) =>
        Promise.resolve(
          tableName.endsWith('2025')
            ? new Set(Array.from({ length: 12 }, (_, index) => index + 1))
            : new Set([1])
        )
      );

    await service.importCategory(olderCategory, true);

    expect(getScraperMonths()).toEqual([
      '1,2,3,4,5,6,7,8,9,10,11,12',
      '1',
    ]);
  });

  it('uses the São Paulo calendar when UTC has already entered a new year', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-01T01:00:00Z'));
    const yearEndCategory = { ...category, years: [2026] };

    await service.importCategory(yearEndCategory, true);

    expect(getScraperMonths()).toEqual(['1,2,3,4,5,6,7,8,9,10,11,12']);
  });

  function getScraperMonths(): string[] {
    return jest
      .mocked(pythonToolService.runAssetScript)
      .mock.calls.map(([, args]) => args[args.indexOf('--months') + 1]);
  }

  function createMetadata(year: number, month: number) {
    return {
      category: category.name,
      year,
      month,
      fileUrl: `https://example.com/Consultas.aspx#${year}-${month}`,
      fileHash: `hash-${month}`,
      fileSize: 100,
      lastDownloaded: new Date('2026-06-13T00:00:00Z'),
      lastImported: new Date('2026-06-13T00:00:00Z'),
      recordCount: 10,
    };
  }
});
