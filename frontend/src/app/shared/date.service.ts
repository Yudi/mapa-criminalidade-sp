import { Injectable } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { compareAsc, format } from 'date-fns';

@Injectable({
  providedIn: 'root',
})
export class DateService {
  formatYYYYMMDD(date: Date | string): string {
    return format(date, 'yyyy-MM-dd');
  }

  beforeAfterFormValidator(
    beforeDateControl: string,
    afterDateControl: string,
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
