import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { DataCategoryConfig } from '../config/data-category.config';
import { DataCategory } from '../types/data-import.types';
import { CsvProcessingService } from './csv-processing.service';
import { CsvTransformationService } from './csv-transformation.service';
import { DatabaseService } from './database.service';
import { FileOperationsService } from './file-operations.service';

describe('CsvProcessingService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'csv-processing-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('transactionally replaces a table once and appends all matching CSV sheets', async () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Dados Criminais'
    ) as DataCategory;
    const firstCsv = path.join(tempDir, 'SPDadosCriminais_2024_JAN-JUN.csv');
    const secondCsv = path.join(tempDir, 'SPDadosCriminais_2024_JUL-DEZ.csv');
    const transactionClient = {};

    await writeFile(firstCsv, '"NUM_BO";"ANO_BO"\n"AA0001";"2024"\n');
    await writeFile(secondCsv, '"NUM_BO";"ANO_BO"\n"BB0001";"2024"\n');
    await writeFile(
      path.join(tempDir, 'SPDadosCriminais_2024_JAN-JUN_transformed.csv'),
      '"NUM_BO";"ANO_BO"\n"AA0001";"2024"\n'
    );

    const fileOperationsService = {
      fileExists: jest.fn().mockResolvedValue(true),
      getFileSize: jest.fn().mockResolvedValue(100),
      cleanup: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileOperationsService;

    const databaseService = {
      checkTableExists: jest.fn().mockResolvedValueOnce(false),
      createTableFromCSVWithTypes: jest.fn().mockResolvedValue(undefined),
      ensureTableMatchesCSV: jest.fn().mockResolvedValue(undefined),
      getTableColumns: jest.fn().mockResolvedValue(['id', 'NUM_BO', 'ANO_BO']),
      truncateTable: jest.fn().mockResolvedValue(undefined),
      importCsvWithCopy: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1),
      markTableForMapFeaturesEtl: jest.fn().mockResolvedValue(undefined),
      runImportTransaction: jest
        .fn()
        .mockImplementation((operation: (db: unknown) => Promise<number>) =>
          operation(transactionClient)
        ),
    } as unknown as DatabaseService;

    const csvTransformationService = {
      transformCsvForDatabase: jest
        .fn()
        .mockImplementation((csvPath: string) => Promise.resolve(csvPath)),
    } as unknown as CsvTransformationService;

    const service = new CsvProcessingService(
      fileOperationsService,
      databaseService,
      csvTransformationService
    );

    const recordCount = await service.importCsvToDatabase(
      tempDir,
      category,
      2024
    );

    expect(recordCount).toBe(2);
    expect(databaseService.createTableFromCSVWithTypes).toHaveBeenCalledTimes(1);
    expect(databaseService.ensureTableMatchesCSV).toHaveBeenCalledTimes(1);
    expect(databaseService.runImportTransaction).toHaveBeenCalledTimes(1);
    expect(databaseService.truncateTable).toHaveBeenCalledTimes(1);
    expect(databaseService.truncateTable).toHaveBeenCalledWith(
      'dados_criminais_2024',
      transactionClient
    );
    expect(databaseService.importCsvWithCopy).toHaveBeenCalledTimes(2);
    expect(databaseService.importCsvWithCopy).toHaveBeenNthCalledWith(
      1,
      'dados_criminais_2024',
      firstCsv,
      transactionClient
    );
    expect(databaseService.importCsvWithCopy).toHaveBeenNthCalledWith(
      2,
      'dados_criminais_2024',
      secondCsv,
      transactionClient
    );
    expect(databaseService.markTableForMapFeaturesEtl).toHaveBeenCalledWith(
      'dados_criminais_2024'
    );
    expect(csvTransformationService.transformCsvForDatabase).toHaveBeenCalledTimes(
      2
    );
    expect(
      csvTransformationService.transformCsvForDatabase
    ).toHaveBeenNthCalledWith(
      1,
      firstCsv,
      'dados_criminais_2024',
      expect.objectContaining({
        DATA_NASCIMENTO_PESSOA: 'DATE',
        HORA_FATO: 'TEXT',
      })
    );
  });

  it('throws when a category sheet pattern matches no CSV files', async () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Produtividade - Armas'
    ) as DataCategory;
    await writeFile(
      path.join(tempDir, 'DadosProdutividade_2024_PRESOS E APREENDIDOS.csv'),
      '"NUM_BO";"ANO_BO"\n"AA0001";"2024"\n'
    );

    const service = new CsvProcessingService(
      {} as FileOperationsService,
      {} as DatabaseService,
      {} as CsvTransformationService
    );

    await expect(
      service.importCsvToDatabase(tempDir, category, 2024)
    ).rejects.toThrow('No CSV files matched category Produtividade - Armas');
  });

  it('transactionally replaces only one IML month', async () => {
    const category = DataCategoryConfig.getImlCategory();
    const csvPath = path.join(tempDir, 'registro_obitos_iml_2026_05.csv');
    const transactionClient = {};
    await writeFile(
      csvPath,
      '"ANO_REFERENCIA";"MES_REFERENCIA"\n"2026";"5"\n'
    );

    const fileOperationsService = {
      fileExists: jest.fn().mockResolvedValue(true),
      getFileSize: jest.fn().mockResolvedValue(100),
      cleanup: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileOperationsService;
    const databaseService = {
      checkTableExists: jest.fn().mockResolvedValue(true),
      getTableColumns: jest
        .fn()
        .mockResolvedValue(['id', 'ANO_REFERENCIA', 'MES_REFERENCIA']),
      ensureTableMatchesCSV: jest.fn().mockResolvedValue(undefined),
      deleteImlMonthRows: jest.fn().mockResolvedValue(undefined),
      importCsvWithCopy: jest.fn().mockResolvedValue(1),
      markTableForMapFeaturesEtl: jest.fn().mockResolvedValue(undefined),
      runImportTransaction: jest
        .fn()
        .mockImplementation((operation: (db: unknown) => Promise<number>) =>
          operation(transactionClient)
        ),
    } as unknown as DatabaseService;
    const csvTransformationService = {
      transformCsvForDatabase: jest
        .fn()
        .mockImplementation((filePath: string) => Promise.resolve(filePath)),
    } as unknown as CsvTransformationService;
    const service = new CsvProcessingService(
      fileOperationsService,
      databaseService,
      csvTransformationService
    );

    const recordCount = await service.importSingleCsvFileReplacingImlMonth(
      csvPath,
      category,
      2026,
      5
    );

    expect(recordCount).toBe(1);
    expect(databaseService.deleteImlMonthRows).toHaveBeenCalledWith(
      'registro_obitos_iml_2026',
      2026,
      5,
      transactionClient
    );
    expect(databaseService.importCsvWithCopy).toHaveBeenCalledWith(
      'registro_obitos_iml_2026',
      csvPath,
      transactionClient
    );
  });
});
