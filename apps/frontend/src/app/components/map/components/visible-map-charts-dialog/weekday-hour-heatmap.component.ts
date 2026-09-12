import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WeekdayHourBucket } from '@mapa-criminalidade/shared-types';

const WEEKDAYS = [
  { isoWeekday: 7, label: 'Domingo' },
  { isoWeekday: 1, label: 'Segunda' },
  { isoWeekday: 2, label: 'Terça' },
  { isoWeekday: 3, label: 'Quarta' },
  { isoWeekday: 4, label: 'Quinta' },
  { isoWeekday: 5, label: 'Sexta' },
  { isoWeekday: 6, label: 'Sábado' },
];

export function buildWeekdayHourMatrix(buckets: readonly WeekdayHourBucket[]) {
  const counts = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const unknownByDay = Array<number>(7).fill(0);
  let unknownHour = 0;
  let unknownDate = 0;
  let unknownBoth = 0;
  for (const bucket of buckets) {
    const knownDay =
      bucket.weekday !== null &&
      Number.isInteger(bucket.weekday) &&
      bucket.weekday >= 1 &&
      bucket.weekday <= 7;
    const knownHour =
      bucket.hour !== null &&
      Number.isInteger(bucket.hour) &&
      bucket.hour >= 0 &&
      bucket.hour <= 23;
    if (!knownHour) unknownHour += bucket.count;
    if (!knownDay) unknownDate += bucket.count;
    if (!knownHour && !knownDay) unknownBoth += bucket.count;
    if (knownDay) {
      if (knownHour) counts[bucket.weekday! - 1][bucket.hour!] += bucket.count;
      else unknownByDay[bucket.weekday! - 1] += bucket.count;
    }
  }
  const maximum = Math.max(0, ...counts.flat());
  const known = counts.flat().reduce((total, count) => total + count, 0);
  return {
    maximum,
    known,
    unknownHour,
    unknownDate,
    unknownBoth,
    rows: WEEKDAYS.map(({ isoWeekday, label }) => ({
      label,
      unknown: unknownByDay[isoWeekday - 1],
      cells: counts[isoWeekday - 1].map((count, hour) => ({
        hour,
        count,
        level: count === 0 ? 0 : Math.max(1, Math.ceil((count / maximum) * 5)),
      })),
    })),
  };
}

@Component({
  selector: 'app-weekday-hour-heatmap',
  imports: [DecimalPipe],
  templateUrl: './weekday-hour-heatmap.component.html',
  styleUrl: './weekday-hour-heatmap.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeekdayHourHeatmapComponent {
  readonly buckets = input.required<WeekdayHourBucket[]>();
  readonly busy = input(false);
  readonly matrix = computed(() => buildWeekdayHourMatrix(this.buckets()));
  readonly hours = Array.from(
    { length: 24 },
    (_, hour) => `${hour.toString().padStart(2, '0')}h`
  );
}
