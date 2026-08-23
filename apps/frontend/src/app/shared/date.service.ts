import { Service } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { compareAsc, format } from 'date-fns';
import { DateRange } from '@mapa-criminalidade/shared-types';

@Service()
export class DateService {
  defaultAfterDate(dateRange: DateRange | null | undefined): Date | null {
    return (
      this.parseDateOnly(dateRange?.defaultAfter) ??
      this.parseDateOnly(dateRange?.earliest)
    );
  }

  parseDateOnly(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));

    if (
      utcDate.getUTCFullYear() !== year ||
      utcDate.getUTCMonth() !== month - 1 ||
      utcDate.getUTCDate() !== day
    ) {
      return null;
    }

    return new Date(year, month - 1, day);
  }

  formatYYYYMMDD(date: Date | string | null | undefined): string {
    if (!date) {
      return '';
    }

    // Keep date-only values timezone independent, but only after validating
    // the calendar components (Date normally rolls 31/02 into March).
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return this.parseDateOnly(date) ? date : '';
    }

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      if (isNaN(dateObj.getTime())) {
        return '';
      }
      return format(dateObj, 'yyyy-MM-dd');
    } catch {
      return '';
    }
  }

  beforeAfterFormValidator(
    beforeDateControl: string,
    afterDateControl: string
  ): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const beforeDate = group.get(beforeDateControl)?.value as
        | Date
        | string
        | null
        | undefined;
      const afterDate = group.get(afterDateControl)?.value as
        | Date
        | string
        | null
        | undefined;

      if (!beforeDate || !afterDate) {
        return null;
      }

      const before = this.toComparableDate(beforeDate);
      const after = this.toComparableDate(afterDate);

      if (!before || !after) {
        return { beforeAfter: true };
      }

      if (compareAsc(before, after) === -1) {
        return { beforeAfter: true }; // Return error if beforeDate is after afterDate
      }

      return null; // Return null if validation passes
    };
  }

  private toComparableDate(value: Date | string): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    return this.parseDateOnly(value) ?? null;
  }
}
