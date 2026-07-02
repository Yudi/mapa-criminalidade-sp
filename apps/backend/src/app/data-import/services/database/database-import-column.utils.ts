import { Logger } from '@nestjs/common';
import { StringUtils } from '../../utils/string.utils';

export const RAW_SOURCE_COLUMN_TYPE = 'TEXT';

export interface ProcessedRawColumns {
  columns: string[];
  types: Record<string, string>;
  logicalTypes: Record<string, string>;
}

export interface CsvColumnMatch {
  columnMapping: Map<string, string>;
  mappedColumns: string[];
  unmatchedColumns: string[];
}

export function applyColumnTypeOverrides(
  inferredTypes: Record<string, string>,
  columnTypeOverrides: Record<string, string>
): Record<string, string> {
  const overrides = normalizeColumnTypeOverrides(columnTypeOverrides);
  if (overrides.size === 0) {
    return inferredTypes;
  }

  const types = { ...inferredTypes };
  for (const column of Object.keys(types)) {
    const normalizedColumn = StringUtils.normalizeColumnName(column);
    const overrideType = overrides.get(normalizedColumn);
    if (overrideType) {
      types[column] = overrideType;
    }
  }

  return types;
}

export function normalizeColumnTypeOverrides(
  columnTypeOverrides: Record<string, string>
): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const [columnName, columnType] of Object.entries(columnTypeOverrides)) {
    overrides.set(
      StringUtils.normalizeColumnName(columnName),
      columnType.toUpperCase()
    );
  }
  return overrides;
}

export function createTextTypeMap(columns: string[]): Record<string, string> {
  return Object.fromEntries(
    columns.map((column) => [column, RAW_SOURCE_COLUMN_TYPE])
  );
}

export function isRawSystemColumn(column: string): boolean {
  return column === 'id' || column === 'created_at';
}

export function buildRawSourceColumns(
  rawColumns: string[],
  logicalRawTypes: Record<string, string>,
  logger: Logger
): ProcessedRawColumns {
  const columns: string[] = [];
  const types: Record<string, string> = {};
  const logicalTypes: Record<string, string> = {};
  const seenColumns = new Set<string>();

  rawColumns.forEach((column, index) => {
    let processedColumn = column;

    if (!column || column.trim() === '') {
      processedColumn = `column_${index + 1}`;
      logger.warn(
        `Found empty column name at index ${index}, using fallback: ${processedColumn}`
      );
    }

    if (processedColumn && processedColumn.trim() !== '') {
      const upperColumn = processedColumn.toUpperCase();
      if (seenColumns.has(upperColumn)) {
        const originalName = processedColumn;
        let suffix = 2;
        while (seenColumns.has(`${upperColumn}_${suffix}`)) {
          suffix++;
        }
        processedColumn = `${processedColumn}_${suffix}`;
        logger.warn(
          `Duplicate column "${originalName}" found at index ${index}, renamed to "${processedColumn}"`
        );
      }

      seenColumns.add(processedColumn.toUpperCase());
      columns.push(processedColumn);
      types[processedColumn] = RAW_SOURCE_COLUMN_TYPE;
      logicalTypes[processedColumn] =
        logicalRawTypes[column] || RAW_SOURCE_COLUMN_TYPE;
    }
  });

  return {
    columns,
    types,
    logicalTypes,
  };
}

export function matchCsvColumnsToTableColumns(
  csvColumns: string[],
  actualColumns: string[],
  logger: Logger
): CsvColumnMatch {
  const columnMapping = new Map<string, string>();
  const mappedColumns: string[] = [];
  const unmatchedColumns: string[] = [];

  for (const csvCol of csvColumns) {
    let matchingDbCol =
      actualColumns.find((dbCol) => dbCol === csvCol) ?? null;

    if (!matchingDbCol) {
      matchingDbCol =
        actualColumns.find(
          (dbCol) => StringUtils.normalizeColumnName(dbCol) === csvCol
        ) ?? null;
    }

    if (!matchingDbCol) {
      matchingDbCol =
        actualColumns.find(
          (dbCol) => dbCol.toLowerCase() === csvCol.toLowerCase()
        ) ?? null;
    }

    if (matchingDbCol) {
      columnMapping.set(csvCol, matchingDbCol);
      mappedColumns.push(`${csvCol}->${matchingDbCol}`);
      logger.verbose(`Mapped CSV "${csvCol}" -> DB "${matchingDbCol}"`);
    } else {
      unmatchedColumns.push(csvCol);
      logger.verbose(`No match for CSV column "${csvCol}"`);
    }
  }

  return {
    columnMapping,
    mappedColumns,
    unmatchedColumns,
  };
}
