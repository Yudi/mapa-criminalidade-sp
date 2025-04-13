import { Injectable } from '@angular/core';
import { format } from 'date-fns';

@Injectable({
  providedIn: 'root',
})
export class DateService {
  formatYYYYMMDD(date: Date | string): string {
    return format(date, 'yyyy-MM-dd');
  }
}
