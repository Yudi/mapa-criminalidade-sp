import { Injectable } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { compareAsc, format } from 'date-fns';
import { DateRange } from '@mapa-criminalidade/shared-types';

@Injectable({
  providedIn: 'root',
})
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

    const [year, month, day] = value.split('-').map(Number);

    if (!year || !month || !day) {
      return null;
    }

    return new Date(year, month - 1, day);
  }

  formatYYYYMMDD(date: Date | string | null | undefined): string {
    if (!date) {
      return '';
    }

    // If it's already in YYYY-MM-DD format, return as-is
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
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
      const beforeDate = group.get(beforeDateControl)?.value;
      const afterDate = group.get(afterDateControl)?.value;

      if (!beforeDate || !afterDate) {
        return null;
      }

      if (compareAsc(new Date(beforeDate), new Date(afterDate)) === -1) {
        return { beforeAfter: true }; // Return error if beforeDate is after afterDate
      }

      return null; // Return null if validation passes
    };
  }
}
