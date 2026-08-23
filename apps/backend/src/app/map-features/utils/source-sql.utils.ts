import { quoteIdentifier } from '../../prisma/sql.utils';

export function sourceTextExpression(column: string | undefined): string {
  if (!column) {
    return `''::text`;
  }

  return `COALESCE(NULLIF(btrim(${sourceTextColumnExpression(
    column
  )}), ''), '')`;
}

export function sourceIntegerExpression(column: string): string {
  const parsed = sourceNumberExpression(column);
  return `CASE
            WHEN ${parsed} = TRUNC(${parsed})
            THEN ${parsed}
            ELSE NULL
          END`;
}

export function sourceNumberExpression(column: string): string {
  const normalized = normalizedSourceNumberTextExpression(column);

  return `CASE
            WHEN btrim(${sourceTextColumnExpression(column)}) ~ '^[+-]?([0-9]+([.,][0-9]+)?|[0-9]{1,3}(\\.[0-9]{3})+,[0-9]+)$'
              AND ${normalized} ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
            THEN ${normalized}::numeric
            ELSE NULL
          END`;
}

export function normalizedSourceNumberTextExpression(column: string): string {
  const compact = `regexp_replace(btrim(${sourceTextColumnExpression(
    column
  )}), '\\s+', '', 'g')`;

  return `CASE
            WHEN ${compact} = '' THEN NULL
            WHEN ${compact} LIKE '%,%' AND ${compact} LIKE '%.%' AND strpos(reverse(${compact}), ',') < strpos(reverse(${compact}), '.')
              THEN replace(replace(${compact}, '.', ''), ',', '.')
            WHEN ${compact} LIKE '%,%' AND ${compact} LIKE '%.%'
              THEN replace(${compact}, ',', '')
            WHEN ${compact} LIKE '%,%'
              THEN replace(${compact}, ',', '.')
            ELSE ${compact}
          END`;
}

export function sourceTextColumnExpression(column: string): string {
  return `${quoteIdentifier(column)}::text`;
}
