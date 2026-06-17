const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T]/;
const BRAZILIAN_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const BRAZILIAN_DASH_DATE_PATTERN = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const EXCEL_SERIAL_MIN = 41275;
const EXCEL_SERIAL_MAX = 73050;

export function sourceValueToString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const text = String(value).trim();
  return text === '' ? undefined : text;
}

export function parseSourceNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = sourceValueToString(value);
  if (!text) {
    return null;
  }

  const normalized = normalizeDecimalText(text);
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSourceInteger(value: unknown): number | null {
  const parsed = parseSourceNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function parseSourceBooleanFlag(value: unknown): boolean | undefined {
  const text = sourceValueToString(value)?.toUpperCase();
  if (!text) {
    return undefined;
  }

  if (['S', 'SIM', 'TRUE', '1'].includes(text)) {
    return true;
  }

  if (['N', 'NAO', 'NÃO', 'FALSE', '0'].includes(text)) {
    return false;
  }

  return undefined;
}

export function parseSourceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = sourceValueToString(value);
  if (!text) {
    return null;
  }

  const isoDateOnlyMatch = ISO_DATE_ONLY_PATTERN.exec(text);
  if (isoDateOnlyMatch) {
    return createUtcDate(
      Number(isoDateOnlyMatch[1]),
      Number(isoDateOnlyMatch[2]),
      Number(isoDateOnlyMatch[3])
    );
  }

  const isoDateTimeMatch = ISO_DATE_TIME_PATTERN.exec(text);
  if (isoDateTimeMatch) {
    return createUtcDate(
      Number(isoDateTimeMatch[1]),
      Number(isoDateTimeMatch[2]),
      Number(isoDateTimeMatch[3])
    );
  }

  const brazilianDateMatch =
    BRAZILIAN_DATE_PATTERN.exec(text) || BRAZILIAN_DASH_DATE_PATTERN.exec(text);
  if (brazilianDateMatch) {
    return createUtcDate(
      Number(brazilianDateMatch[3]),
      Number(brazilianDateMatch[2]),
      Number(brazilianDateMatch[1])
    );
  }

  const excelSerialDate = parseExcelSerialDate(text);
  if (excelSerialDate) {
    return excelSerialDate;
  }

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

export function formatSourceDateOnly(value: unknown): string | undefined {
  const date = parseSourceDate(value);
  return date ? date.toISOString().slice(0, 10) : undefined;
}

function normalizeDecimalText(value: string): string {
  const compact = value.trim().replace(/\s+/g, '');
  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');

  if (hasComma && hasDot) {
    const lastComma = compact.lastIndexOf(',');
    const lastDot = compact.lastIndexOf('.');

    if (lastComma > lastDot) {
      return compact.replace(/\./g, '').replace(',', '.');
    }

    return compact.replace(/,/g, '');
  }

  return hasComma ? compact.replace(',', '.') : compact;
}

function parseExcelSerialDate(value: string): Date | null {
  const serial = parseSourceNumber(value);
  if (serial === null) {
    return null;
  }

  const serialDay = Math.floor(serial);
  if (serialDay < EXCEL_SERIAL_MIN || serialDay > EXCEL_SERIAL_MAX) {
    return null;
  }

  const excelEpoch = Date.UTC(1899, 11, 31);
  const adjustedSerial = serialDay > 59 ? serialDay - 1 : serialDay;
  return new Date(excelEpoch + adjustedSerial * 86_400_000);
}

function createUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}
