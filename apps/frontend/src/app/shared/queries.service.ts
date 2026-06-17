import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { of, shareReplay, take, Observable, catchError, map } from 'rxjs';
import {
  CategoryInfo,
  GroupedOccurrence,
} from '@mapa-criminalidade/shared-types';
import { DateService } from './date.service';
import { OccurrencesService } from './occurrences.service';

interface AddressCoordinate {
  lat: number;
  lon: number;
}

interface NominatimAddressResult {
  lat: string;
  lon: string;
}

@Injectable({
  providedIn: 'root',
})
export class QueriesService {
  private http = inject(HttpClient);
  private dateService = inject(DateService);
  private occurrencesService = inject(OccurrencesService);

  private requestCache = new Map<string, Observable<unknown>>();

  private checkCache(cacheKey: string) {
    return this.requestCache.has(cacheKey);
  }

  private getCachedResult<T>(cacheKey: string): Observable<T> | null {
    const cachedResult = this.requestCache.get(cacheKey);
    return cachedResult ? (cachedResult as Observable<T>) : null;
  }

  getAddressData(
    street: string,
    city: string,
    state: string
  ): Observable<AddressCoordinate[] | null> {
    const cacheKey = `getAddressData-${street}-${city}-${state}`;

    if (this.checkCache(cacheKey)) {
      const cachedResult = this.requestCache.get(cacheKey);
      if (cachedResult) {
        return cachedResult as Observable<AddressCoordinate[] | null>;
      }
    }

    const params = new HttpParams()
      .set('format', 'json')
      .set('street', street)
      .set('city', city)
      .set('state', state)
      .set('country', 'Brazil');

    const request = this.http
      .get<NominatimAddressResult[]>(
        'https://nominatim.openstreetmap.org/search',
        { params }
      )
      .pipe(
        take(1),
        map((results) =>
          results
            .map((result) => ({
              lat: Number(result.lat),
              lon: Number(result.lon),
            }))
            .filter(
              (coordinate) =>
                Number.isFinite(coordinate.lat) &&
                Number.isFinite(coordinate.lon)
            )
        ),
        shareReplay(1),
        catchError(() => {
          console.error(
            `Error fetching address data for ${street}, ${city}, ${state}`
          );
          return of(null);
        })
      );

    this.requestCache.set(cacheKey, request);

    return request;
  }

  /**
   * @deprecated Use OccurrencesService.getCategoriesForLocation() instead
   */
  listRubricasForPoint(
    lat: number,
    lon: number,
    radius: number,
    before: string,
    after: string
  ) {
    if (!lat || !lon || !radius) {
      return of(null);
    }
    const formattedBefore = before
      ? this.dateService.formatYYYYMMDD(before)
      : '';
    const formattedAfter = after ? this.dateService.formatYYYYMMDD(after) : '';

    const cacheKey = `listRubricasForPoint-${lat}-${lon}-${radius}-${formattedBefore}-${formattedAfter}`;

    if (this.checkCache(cacheKey)) {
      const cached = this.getCachedResult<CategoryInfo[]>(cacheKey);
      if (cached) return cached;
    }

    const request = this.occurrencesService
      .getCategoriesForLocation(
        lat,
        lon,
        radius,
        formattedBefore,
        formattedAfter
      )
      .pipe(take(1), shareReplay(1));
    this.requestCache.set(cacheKey, request);
    return request;
  }

  /**
   * @deprecated Use OccurrencesService.getOccurrencesByNumBo() instead
   */
  getBoletimByNumBo(numBo: string): Observable<GroupedOccurrence | null> {
    const cacheKey = `getBoletimByNumBo-${numBo}`;

    if (this.checkCache(cacheKey)) {
      const cached = this.getCachedResult<GroupedOccurrence | null>(cacheKey);
      if (cached) return cached;
    }

    const request = this.occurrencesService.getOccurrencesByNumBo(numBo).pipe(
      take(1),
      shareReplay(1),
      catchError(() => {
        console.error(`Error fetching occurrence with NUM_BO ${numBo}`);
        return of(null);
      })
    );

    this.requestCache.set(cacheKey, request);
    return request;
  }
}
