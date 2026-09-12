import {
  categoryChanges,
  compareRanges,
  monthlyFrames,
} from './temporal-analysis.utils';

const coverage = {
  earliest: '2020-01-01',
  latest: '2026-09-10',
  defaultAfter: '2026-01-01',
};
const today = '2026-09-12';

describe('temporal calendar alignment', () => {
  it('compares equal days in months of different lengths', () => {
    const result = compareRanges(
      '2025-02',
      '2025-03',
      'month',
      coverage,
      today
    );
    expect(result?.first).toEqual({
      afterDate: '2025-02-01',
      beforeDate: '2025-02-28',
    });
    expect(result?.second).toEqual({
      afterDate: '2025-03-01',
      beforeDate: '2025-03-28',
    });
    expect(result?.days).toEqual([28, 28]);
    expect(result?.partial).toBe(true);
  });
  it('aligns partial years by calendar date, not ordinal day', () => {
    const result = compareRanges('2024', '2026', 'year', coverage, today);
    expect(result?.first.beforeDate).toBe('2024-09-10');
    expect(result?.second.beforeDate).toBe('2026-09-10');
    expect(result?.days[0]).toBe((result?.days[1] ?? 0) + 1);
  });
  it('matches leap and non-leap February without rolling into March', () => {
    const result = compareRanges(
      '2024-02',
      '2025-02',
      'month',
      coverage,
      today
    );
    expect(result?.first.beforeDate).toBe('2024-02-28');
    expect(result?.second.beforeDate).toBe('2025-02-28');
  });
  it('trims matching starts when coverage begins midway through a month', () => {
    const result = compareRanges(
      '2020-01',
      '2021-01',
      'month',
      { ...coverage, earliest: '2020-01-15' },
      today
    );
    expect(result?.first.afterDate).toBe('2020-01-15');
    expect(result?.second.afterDate).toBe('2021-01-15');
  });
  it('excludes the current day even if future-dated records exist', () => {
    const result = compareRanges(
      '2025-09',
      '2026-09',
      'month',
      { ...coverage, latest: '2027-01-01' },
      today
    );
    expect(result?.second.beforeDate).toBe('2026-09-11');
    expect(result?.first.beforeDate).toBe('2025-09-11');
  });
  it('rejects invalid, identical and unavailable periods', () => {
    for (const [a, b] of [
      ['2020-00', '2020-01'],
      ['2020-01', '2020-01'],
      ['2019-01', '2020-01'],
      ['2020-01', '2027-01'],
    ]) {
      expect(compareRanges(a, b, 'month', coverage, today)).toBeNull();
    }
  });
  it('fills missing months with zeros and retains unknown coverage as null', () => {
    const frames = monthlyFrames(
      { afterDate: '2019-12-01', beforeDate: '2020-03-12' },
      coverage,
      [{ label: '2020-02', count: 5 }],
      today
    );
    expect(frames.map((frame) => frame.count)).toEqual([null, 0, 5, 0]);
    expect(frames.map((frame) => frame.partial)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(frames[3].beforeDate).toBe('2020-03-12');
  });
  it('bounds the timeline and rejects impossible calendar dates', () => {
    expect(
      monthlyFrames(
        { afterDate: '2020-01-01', beforeDate: '2020-02-30' },
        coverage,
        [],
        today
      )
    ).toEqual([]);
    expect(
      monthlyFrames(
        { afterDate: '2000-01-01', beforeDate: '2026-01-01' },
        coverage,
        [],
        today
      )
    ).toEqual([]);
  });
  it('includes categories present on only one side without infinite percentages', () => {
    const rows = categoryChanges(
      [{ label: 'Furto', count: 4 }],
      [{ label: 'Roubo', count: 2 }]
    );
    expect(rows).toEqual([
      { label: 'Furto', baseline: 4, current: 0, delta: -4, percent: -100 },
      { label: 'Roubo', baseline: 0, current: 2, delta: 2, percent: null },
    ]);
  });
});
