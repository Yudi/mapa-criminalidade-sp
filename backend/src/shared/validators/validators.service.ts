import { Injectable } from '@nestjs/common';

@Injectable()
export class ValidatorsService {
  isRadiusValid(radius: number): boolean {
    return radius >= 1 && radius <= 10000;
  }

  isCoordinatesValid(lon: number, lat: number): boolean {
    return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  }

  isDateValid(date: string): boolean {
    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    return dateRegex.test(date);
  }
}
