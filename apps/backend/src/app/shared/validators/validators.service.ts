import { Injectable } from '@nestjs/common';
import { compareAsc } from 'date-fns';

@Injectable()
export class ValidatorsService {
  isRadiusValid(radius: number): boolean {
    return Number.isFinite(radius) && radius >= 1 && radius <= 10000;
  }
  isCoordinatesValid(lon: number, lat: number): boolean {
    return (
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      lon >= -180 &&
      lon <= 180 &&
      lat >= -90 &&
      lat <= 90
    );
  }
  isDateValid(date: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return false;
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }

  isBeforeAfterValid(beforeDate: string, afterDate: string): boolean {
    if (!this.isDateValid(beforeDate) || !this.isDateValid(afterDate)) {
      return false;
    }

    if (compareAsc(new Date(beforeDate), new Date(afterDate)) === -1) {
      return false;
    }
    return true;
  }
}
