import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { DataCategoryConfig } from '../config/data-category.config';
import { DataCategory } from '../types/data-import.types';
import { DatabaseService } from './database.service';
import { FileOperationsService } from './file-operations.service';
import { ParquetProcessingService } from './parquet-processing.service';

describe('ParquetProcessingService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'parquet-processing-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prepares a table from matching Parquet sheets and imports them together', async () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Dados Criminais'
    ) as DataCategory;
    const firstParquet = path.join(
      tempDir,
      'SPDadosCriminais_2024_JAN-JUN.parquet'
    );
    const secondParquet = path.join(
      tempDir,
      'SPDadosCriminais_2024_JUL-DEZ.parquet'
    );

    await writeFile(firstParquet, 'parquet-placeholder');
    await writeFile(secondParquet, 'parquet-placeholder');

    const fileOperationsService = {
      fileExists: jest.fn().mockResolvedValue(true),
      getFileSize: jest.fn().mockResolvedValue(100),
    } as unknown as FileOperationsService;

    const databaseService = {
      checkTableExists: jest.fn().mockResolvedValueOnce(false),
      createTableFromDataFileWithTypes: jest.fn().mockResolvedValue(undefined),
      ensureTableMatchesDataFile: jest.fn().mockResolvedValue(undefined),
      importParquetFilesWithRust: jest.fn().mockResolvedValue(2),
      markTableForMapFeaturesEtl: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;

    const service = new ParquetProcessingService(
      fileOperationsService,
      databaseService
    );

    const recordCount = await service.importParquetToDatabase(
      tempDir,
      category,
      2024
    );

    expect(recordCount).toBe(2);
    expect(databaseService.createTableFromDataFileWithTypes).toHaveBeenCalledWith(
      'dados_criminais_2024',
      firstParquet,
      expect.objectContaining({
        DATA_NASCIMENTO_PESSOA: 'DATE',
        HORA_FATO: 'TEXT',
      })
    );
    expect(databaseService.ensureTableMatchesDataFile).toHaveBeenCalledWith(
      'dados_criminais_2024',
      secondParquet,
      expect.any(Object)
    );
    expect(databaseService.importParquetFilesWithRust).toHaveBeenCalledWith(
      'dados_criminais_2024',
      [firstParquet, secondParquet],
      expect.any(Object)
    );
    expect(databaseService.markTableForMapFeaturesEtl).toHaveBeenCalledWith(
      'dados_criminais_2024'
    );
  });

  it('throws when a category sheet pattern matches no Parquet files', async () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Produtividade - Armas'
    ) as DataCategory;
    await writeFile(
      path.join(tempDir, 'DadosProdutividade_2024_PRESOS E APREENDIDOS.parquet'),
      'parquet-placeholder'
    );

    const service = new ParquetProcessingService(
      {} as FileOperationsService,
      {} as DatabaseService
    );

    await expect(
      service.importParquetToDatabase(tempDir, category, 2024)
    ).rejects.toThrow('No Parquet files matched category Produtividade - Armas');
  });
});
