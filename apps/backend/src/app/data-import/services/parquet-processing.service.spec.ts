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
    await writeFile(
      path.join(tempDir, 'source_manifest.json'),
      JSON.stringify({
        manifest_version: 1,
        input_path: '/tmp/source.xlsx',
        format: 'parquet',
        complete: true,
        sheets: [
          {
            sheet: 'SPDadosCriminais_2024_JAN-JUN',
            rows: 1,
            columns: 2,
            output_path: firstParquet,
          },
          {
            sheet: 'SPDadosCriminais_2024_JUL-DEZ',
            rows: 1,
            columns: 2,
            output_path: secondParquet,
          },
        ],
        skipped_sheets: [],
      })
    );

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
    expect(
      databaseService.createTableFromDataFileWithTypes
    ).toHaveBeenCalledWith(
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
      path.join(
        tempDir,
        'DadosProdutividade_2024_PRESOS E APREENDIDOS.parquet'
      ),
      'parquet-placeholder'
    );
    await writeFile(
      path.join(tempDir, 'source_manifest.json'),
      JSON.stringify({
        manifest_version: 1,
        input_path: '/tmp/source.xlsx',
        format: 'parquet',
        complete: true,
        sheets: [
          {
            sheet: 'PRESOS E APREENDIDOS',
            rows: 1,
            columns: 2,
            output_path: path.join(
              tempDir,
              'DadosProdutividade_2024_PRESOS E APREENDIDOS.parquet'
            ),
          },
        ],
        skipped_sheets: [],
      })
    );

    const service = new ParquetProcessingService(
      {} as FileOperationsService,
      {} as DatabaseService
    );

    await expect(
      service.importParquetToDatabase(tempDir, category, 2024)
    ).rejects.toThrow(
      'No Parquet files matched category Produtividade - Armas'
    );
  });

  it('rejects an incomplete conversion manifest before replacing the table', async () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Dados Criminais'
    ) as DataCategory;
    const parquetPath = path.join(tempDir, 'source_data.parquet');
    await writeFile(parquetPath, 'parquet-placeholder');
    await writeFile(
      path.join(tempDir, 'source_manifest.json'),
      JSON.stringify({
        manifest_version: 1,
        input_path: '/tmp/source.xlsx',
        format: 'parquet',
        complete: false,
        sheets: [
          {
            sheet: 'source_data',
            rows: 1,
            columns: 2,
            output_path: parquetPath,
          },
        ],
        skipped_sheets: [{ sheet: 'source_failed', error: 'bad sheet' }],
      })
    );
    const databaseService = {
      importParquetFilesWithRust: jest.fn(),
    } as unknown as DatabaseService;
    const service = new ParquetProcessingService(
      {
        fileExists: jest.fn().mockResolvedValue(true),
      } as unknown as FileOperationsService,
      databaseService
    );

    await expect(
      service.importParquetToDatabase(tempDir, category, 2024)
    ).rejects.toThrow('Conversion manifest is incomplete');
    expect(databaseService.importParquetFilesWithRust).not.toHaveBeenCalled();
  });

  it('uses only manifest sheets selected by a category pattern', async () => {
    const category = DataCategoryConfig.getCategoryByName(
      'Produtividade - Armas'
    ) as DataCategory;
    const armasPath = path.join(
      tempDir,
      'DadosProdutividade_2024_ARMAS DE FOGO APREENDIDAS.parquet'
    );
    const otherPath = path.join(
      tempDir,
      'DadosProdutividade_2024_PRESOS E APREENDIDOS.parquet'
    );
    await writeFile(armasPath, 'parquet-placeholder');
    await writeFile(otherPath, 'parquet-placeholder');
    await writeFile(
      path.join(tempDir, 'source_manifest.json'),
      JSON.stringify({
        manifest_version: 1,
        input_path: '/tmp/source.xlsx',
        format: 'parquet',
        complete: true,
        sheets: [
          {
            sheet: 'ARMAS DE FOGO APREENDIDAS',
            rows: 1,
            columns: 2,
            output_path: armasPath,
          },
          {
            sheet: 'PRESOS E APREENDIDOS',
            rows: 1,
            columns: 2,
            output_path: otherPath,
          },
        ],
        skipped_sheets: [],
      })
    );
    const databaseService = {
      checkTableExists: jest.fn().mockResolvedValue(false),
      createTableFromDataFileWithTypes: jest.fn().mockResolvedValue(undefined),
      importParquetFilesWithRust: jest.fn().mockResolvedValue(1),
      markTableForMapFeaturesEtl: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;
    const service = new ParquetProcessingService(
      {
        fileExists: jest.fn().mockResolvedValue(true),
        getFileSize: jest.fn().mockResolvedValue(100),
      } as unknown as FileOperationsService,
      databaseService
    );

    await service.importParquetToDatabase(tempDir, category, 2024);

    expect(databaseService.importParquetFilesWithRust).toHaveBeenCalledWith(
      'produtividade_armas_2024',
      [armasPath],
      expect.any(Object)
    );
  });
});
