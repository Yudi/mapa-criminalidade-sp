import { DataCategoryConfig } from '../config/data-category.config';
import { DataCategory } from '../types/data-import.types';
import { DatabaseService } from './database.service';
import { ImportStatusService } from './import-status.service';

describe('ImportStatusService', () => {
  const category: DataCategory = {
    name: 'Dados Criminais',
    baseUrl: 'https://example.com/source_',
    years: [2025, 2026],
    tablePrefix: 'dados_criminais',
    hasSchema: true,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('counts only existing tables and reports missing tables without scanning them', async () => {
    jest.spyOn(DataCategoryConfig, 'getDataCategories').mockReturnValue([
      category,
    ]);
    const databaseService = {
      checkTableExists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      getTableRecordCount: jest.fn().mockResolvedValue(42),
    } as unknown as DatabaseService;
    const service = new ImportStatusService(databaseService);

    await expect(service.getImportStatus()).resolves.toEqual({
      'Dados Criminais': {
        2025: { tableExists: true, recordCount: 42 },
        2026: { tableExists: false, recordCount: 0 },
      },
    });
    expect(databaseService.getTableRecordCount).toHaveBeenCalledTimes(1);
    expect(databaseService.getTableRecordCount).toHaveBeenCalledWith(
      'dados_criminais_2025'
    );
  });

  it('derives aggregate statistics from one status snapshot', async () => {
    const service = new ImportStatusService({} as DatabaseService);
    jest.spyOn(service, 'getImportStatus').mockResolvedValue({
      'Dados Criminais': {
        2025: { tableExists: true, recordCount: 10 },
        2026: { tableExists: true, recordCount: 0 },
      },
      Celulares: {
        2026: { tableExists: false, recordCount: 0 },
      },
    });

    await expect(service.getImportStatistics()).resolves.toEqual({
      totalCategories: 2,
      categoriesWithData: 1,
      totalTables: 3,
      tablesWithData: 1,
      totalRecords: 10,
    });
  });
});
