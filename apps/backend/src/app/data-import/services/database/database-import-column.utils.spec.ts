import { Logger } from '@nestjs/common';
import { matchCsvColumnsToTableColumns } from './database-import-column.utils';

describe('matchCsvColumnsToTableColumns', () => {
  const logger = new Logger('mapping-test');

  it('reserves each database target and reports normalized collisions', () => {
    const result = matchCsvColumnsToTableColumns(
      ['Número BO', 'NUMERO_BO', 'ANO BO'],
      ['NUMERO_BO', 'ANO_BO'],
      logger
    );

    expect(result.columnMapping).toEqual(
      new Map([
        ['Número BO', 'NUMERO_BO'],
        ['ANO BO', 'ANO_BO'],
      ])
    );
    expect(result.unmatchedColumns).toEqual(['NUMERO_BO']);
    expect(result.duplicateTargetColumns).toEqual(['NUMERO_BO']);
  });
});
