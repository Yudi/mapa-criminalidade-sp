import { Injectable } from '@nestjs/common';

@Injectable()
export class ValidatorsService {
  /**
   * Validates if the given radius is within the acceptable range.
   *
   * @param radius - The radius value to validate.
   * @returns `true` if the radius is between 1 and 10,000 (inclusive), otherwise `false`.
   */
  isRadiusValid(radius: number): boolean {
    return radius >= 1 && radius <= 10000;
  }

  /**
   * Validates whether the given longitude and latitude coordinates are within valid ranges.
   *
   * @param lon - The longitude value to validate. Must be between -180 and 180 (inclusive).
   * @param lat - The latitude value to validate. Must be between -90 and 90 (inclusive).
   * @returns `true` if both longitude and latitude are within their respective valid ranges, otherwise `false`.
   */
  isCoordinatesValid(lon: number, lat: number): boolean {
    return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  }

  /**
   * Validates whether a given string is in the format of a valid date (YYYY-MM-DD).
   *
   * @param date - The date string to validate.
   * @returns `true` if the date string matches the format YYYY-MM-DD, otherwise `false`.
   */
  isDateValid(date: string): boolean {
    const dateRegex = /^\d{4}\-\d{2}\-\d{2}$/;
    return dateRegex.test(date);
  }
}
