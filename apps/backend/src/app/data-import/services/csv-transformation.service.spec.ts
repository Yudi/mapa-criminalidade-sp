import * as path from 'path';
import { CsvTransformationService } from './csv-transformation.service';
import { DatabaseService } from './database.service';
import { RustToolService } from './rust-tool.service';

describe('CsvTransformationService', () => {
  const rustToolService = {
    runWithDatasetHandlingSlot: jest.fn((operation: () => Promise<unknown>) =>
      operation()
    ),
  } as unknown as RustToolService;

  it('creates unique transformed CSV paths for repeated transforms of the same file', () => {
    const service = new CsvTransformationService(
      {} as DatabaseService,
      rustToolService
    );
    const csvPath = path.join(
      '/tmp',
      'produtividade_2026_shared_csv',
      'DadosProdutividade_2026_PRESOS E APREENDIDOS_2026.csv'
    );
    const pathFactory = service as unknown as {
      createTransformedCsvPath(inputPath: string): string;
    };

    const firstPath = pathFactory.createTransformedCsvPath(csvPath);
    const secondPath = pathFactory.createTransformedCsvPath(csvPath);

    expect(firstPath).not.toBe(secondPath);
    expect(path.dirname(firstPath)).toBe(path.dirname(csvPath));
    expect(path.dirname(secondPath)).toBe(path.dirname(csvPath));
    expect(path.basename(firstPath)).toMatch(
      /^DadosProdutividade_2026_PRESOS E APREENDIDOS_2026_\d+_\d+_[0-9a-f]{8}_transformed\.csv$/
    );
    expect(path.basename(secondPath)).toMatch(
      /^DadosProdutividade_2026_PRESOS E APREENDIDOS_2026_\d+_\d+_[0-9a-f]{8}_transformed\.csv$/
    );
  });

  it('normalizes configured column type overrides for Rust cleaning', () => {
    const service = new CsvTransformationService(
      {} as DatabaseService,
      rustToolService
    );
    const transformer = service as unknown as {
      applyColumnTypeOverrides(
        columnTypes: Record<string, string>,
        columnTypeOverrides: Record<string, string>
      ): void;
      isSpecialColumnType(columnType: string): boolean;
    };
    const columnTypes = {
      DATA_NASCIMENTO_PESSOA: 'text',
    };

    transformer.applyColumnTypeOverrides(columnTypes, {
      'Data Nascimento Pessoa': 'DATE',
      HORA_FATO: 'TIME',
    });

    expect(columnTypes).toEqual({
      DATA_NASCIMENTO_PESSOA: 'date',
      HORA_FATO: 'time',
    });
    expect(transformer.isSpecialColumnType('DATE')).toBe(true);
  });
});
