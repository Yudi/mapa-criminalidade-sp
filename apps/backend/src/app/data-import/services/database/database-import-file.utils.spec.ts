import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  convertToPostgresSharedPath,
  countCsvDataRows,
  readCsvHeaderColumns,
} from './database-import-file.utils';

describe('database import file utilities', () => {
  it('parses quoted delimiters, escaped quotes, BOM, and multiline fields', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-header-'));
    const csvPath = path.join(directory, 'input.csv');
    await fs.writeFile(
      csvPath,
      '\uFEFF"NOME;COMPLETO";"DIZER ""OI"""\n"Ana;Silva";"linha 1\nlinha 2"\n'
    );

    await expect(readCsvHeaderColumns(csvPath)).resolves.toEqual([
      'NOME;COMPLETO',
      'DIZER "OI"',
    ]);
    await expect(countCsvDataRows(csvPath)).resolves.toBe(1);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('does not treat a sibling temp prefix as an in-container path', () => {
    const cwd = '/srv/app';
    expect(convertToPostgresSharedPath('/srv/app/temp-evil/file.csv', cwd)).toBe(
      '/srv/app/temp-evil/file.csv'
    );
    expect(convertToPostgresSharedPath('/srv/app/temp/nested/file.csv', cwd)).toBe(
      '/tmp/shared_import/nested/file.csv'
    );
  });
});
