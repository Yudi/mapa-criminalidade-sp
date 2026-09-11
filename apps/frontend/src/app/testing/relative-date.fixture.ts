import type { DateRange } from '@mapa-criminalidade/shared-types';
import { format, subDays, subMonths, subYears } from 'date-fns';

const DATE_ONLY_FORMAT = 'yyyy-MM-dd';

export function createRelativeDateRange(now = new Date()) {
  const latest = subDays(now, 1);

  return {
    earliest: format(subYears(latest, 10), DATE_ONLY_FORMAT),
    latest: format(latest, DATE_ONLY_FORMAT),
    defaultAfter: format(subMonths(latest, 3), DATE_ONLY_FORMAT),
  } satisfies DateRange;
}
