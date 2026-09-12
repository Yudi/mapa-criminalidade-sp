import {
  DateRange,
  MapFeatureChartBucket,
} from '@mapa-criminalidade/shared-types';

export interface TemporalRange {
  afterDate: string;
  beforeDate: string;
}
export type ComparisonUnit = 'month' | 'year';
export interface MonthlyFrame extends TemporalRange {
  month: string;
  label: string;
  count: number | null;
  partial: boolean;
}
const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(day(value).getTime()) &&
  iso(day(value)) === value;
const latest = (...dates: string[]) => dates.reduce((a, b) => (a > b ? a : b));
export const previousDay = (value: string) =>
  iso(new Date(day(value).getTime() - DAY));
export const brazilToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const displayDate = (value: string) =>
  value.split('-').reverse().join('/');
export const displayMonth = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(day(`${value}-01`));

export function periodRange(
  value: string,
  unit: ComparisonUnit
): TemporalRange | null {
  if (!(unit === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}$/).test(value))
    return null;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2100) return null;
  const month = unit === 'month' ? Number(value.slice(5, 7)) - 1 : 0;
  return {
    afterDate: iso(new Date(Date.UTC(year, month, 1))),
    beforeDate: iso(
      new Date(Date.UTC(year, unit === 'month' ? month + 1 : 12, 0))
    ),
  };
}

/** Align calendar positions, including leap-year February, without rolling into March. */
export function compareRanges(
  a: string,
  b: string,
  unit: ComparisonUnit,
  coverage: DateRange,
  today = brazilToday()
) {
  const first = periodRange(a, unit);
  const second = periodRange(b, unit);
  if (!first || !second || !coverage.earliest || !coverage.latest || a === b)
    return null;
  const earliest = coverage.earliest;
  const cutoff = [coverage.latest, previousDay(today)].sort()[0];
  const slot = (date: string) =>
    unit === 'month' ? date.slice(8) : date.slice(5);
  const available = [first, second].map((range) => ({
    afterDate: latest(range.afterDate, earliest),
    beforeDate: [range.beforeDate, cutoff].sort()[0],
  }));
  if (available.some((range) => range.afterDate > range.beforeDate))
    return null;
  const start = latest(...available.map((range) => slot(range.afterDate)));
  const end = available.map((range) => slot(range.beforeDate)).sort()[0];
  if (start > end) return null;
  const align = (range: TemporalRange): TemporalRange => {
    const prefix =
      unit === 'month'
        ? range.afterDate.slice(0, 8)
        : range.afterDate.slice(0, 5);
    // A shared Feb 29 boundary is clamped for non-leap years.
    const clamp = (position: string) => {
      const candidate = prefix + position;
      const monthEnd =
        periodRange(candidate.slice(0, 7), 'month')?.beforeDate ?? candidate;
      return candidate > monthEnd ? monthEnd : candidate;
    };
    return { afterDate: clamp(start), beforeDate: clamp(end) };
  };
  const ranges = [align(first), align(second)];
  return {
    first: ranges[0],
    second: ranges[1],
    partial: ranges.some(
      (range, index) =>
        range.afterDate !== [first, second][index].afterDate ||
        range.beforeDate !== [first, second][index].beforeDate
    ),
    days: ranges.map(
      (range) =>
        Math.round(
          (day(range.beforeDate).getTime() - day(range.afterDate).getTime()) /
            DAY
        ) + 1
    ),
  };
}

export function monthlyFrames(
  range: TemporalRange,
  coverage: DateRange,
  buckets: MapFeatureChartBucket[],
  today = brazilToday()
): MonthlyFrame[] {
  if (
    !validDate(range.afterDate) ||
    !validDate(range.beforeDate) ||
    range.afterDate > range.beforeDate
  )
    return [];
  const frames: MonthlyFrame[] = [];
  const counts = new Map(buckets.map((bucket) => [bucket.label, bucket.count]));
  const date = day(range.afterDate.slice(0, 7) + '-01');
  const cutoff = [coverage.latest ?? '', previousDay(today)].sort()[0];
  while (iso(date) <= range.beforeDate && frames.length <= 120) {
    const month = iso(date).slice(0, 7);
    const full = periodRange(month, 'month');
    if (!full) return [];
    const afterDate = latest(
      full.afterDate,
      range.afterDate,
      coverage.earliest ?? '9999-12-31'
    );
    const beforeDate = [full.beforeDate, range.beforeDate, cutoff].sort()[0];
    frames.push({
      month,
      label: displayMonth(month),
      afterDate,
      beforeDate,
      count: afterDate <= beforeDate ? counts.get(month) ?? 0 : null,
      partial: afterDate !== full.afterDate || beforeDate !== full.beforeDate,
    });
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return frames.length > 120 ? [] : frames;
}

export function categoryChanges(
  first: MapFeatureChartBucket[],
  second: MapFeatureChartBucket[]
) {
  const a = new Map(first.map((bucket) => [bucket.label, bucket.count]));
  const b = new Map(second.map((bucket) => [bucket.label, bucket.count]));
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((label) => {
      const baseline = a.get(label) ?? 0;
      const current = b.get(label) ?? 0;
      return {
        label,
        baseline,
        current,
        delta: current - baseline,
        percent:
          baseline === 0 ? null : ((current - baseline) / baseline) * 100,
      };
    });
}

export interface TemporalMapState {
  after: string | null;
  before: string | null;
  status: 'ready' | 'loading' | 'error';
}
