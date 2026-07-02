import { quoteIdentifier, quoteLiteral } from '../../../prisma/sql.utils';

export function buildCreateRawTableSql(
  rawTableName: string,
  columns: string[],
  types: Record<string, string>
): string {
  const columnDefinitions = columns
    .map((column) => {
      const type = types[column];
      return `${quoteIdentifier(column)} ${type}`;
    })
    .join(',\n  ');

  return `
      CREATE TABLE IF NOT EXISTS ${rawTableName} (
        id SERIAL PRIMARY KEY,
        ${columnDefinitions},
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
}

export function buildCopyCsvSql(
  rawTableName: string,
  dbColumnsToUse: string[],
  postgresFilePath: string
): string {
  return `
      COPY ${rawTableName} (${dbColumnsToUse
      .map((col) => quoteIdentifier(col))
      .join(', ')})
      FROM ${quoteLiteral(postgresFilePath)}
      WITH (
        FORMAT csv,
        HEADER true,
        DELIMITER ';',
        NULL '',
        QUOTE '"',
        ESCAPE '"'
      )
    `;
}
