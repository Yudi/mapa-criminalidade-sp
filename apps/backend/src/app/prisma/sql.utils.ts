export const RAW_SCHEMA = 'raw';

export function quoteIdentifier(identifier: string): string {
  if (identifier.includes('\0')) {
    throw new Error('SQL identifier contains a null byte');
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  if (value.includes('\0')) {
    throw new Error('SQL literal contains a null byte');
  }

  return `'${value.replace(/'/g, "''")}'`;
}

export function qualifiedTableName(
  tableName: string,
  schemaName = RAW_SCHEMA
): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}
