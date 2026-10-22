import { quoteIdentifier, quoteLiteral } from '../prisma/sql.utils';

export const MODERN_BO_PATTERN = '^([A-Z]{2}[0-9]{4})(-[1-9][0-9]*)?$';
const MODERN_BO_REGEX = new RegExp(MODERN_BO_PATTERN);

export const IML_KNOWN_BO_PREDICATE = `
  "NUM_BO_NORMALIZED" <> ''
  AND "ANO_BO" <> ''
  AND "DELEGACIA_REGISTRO_NORMALIZED" <> ''
`;

export function getModernBoNumber(value: string, year: number): string | null {
  if (!Number.isInteger(year) || year < 2021) return null;

  const match = MODERN_BO_REGEX.exec(value.trim().toUpperCase());
  const baseBo = match?.[1];
  // Zero serials occur in inconsistent IML references; do not relax their unit matching.
  return baseBo && !baseBo.endsWith('0000') ? baseBo : null;
}

/** Must match the expressions in the BO lookup indexes. */
export function modernBoExpression(column: string): string {
  return `substring(upper(btrim(${quoteIdentifier(
    column
  )})) from ${quoteLiteral(MODERN_BO_PATTERN)})`;
}
