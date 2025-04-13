import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { of, shareReplay, take, tap, Observable, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { BoletimOcorrencia } from './schema.interface';
import { DateService } from './date.service';

@Injectable({
  providedIn: 'root',
})
export class QueriesService {
  private http = inject(HttpClient);
  private dateService = inject(DateService);

  // Cache to store the results of HTTP requests
  private requestCache = new Map<string, Observable<any>>();
  private checkCache(cacheKey: string) {
    return this.requestCache.has(cacheKey);
  }
  ////

  getLastDate() {
    const request = this.http
      .get<string>(environment.apiUrl + '/boletins-ocorrencia/last-date')
      .pipe(
        take(1),
        tap((response) => {
          if (response) {
            this.requestCache.set('getLastDate', of(response));
          }
        }),
        catchError(() => {
          console.error('Error fetching last date');
          return of(null);
        }),
      );

    return request;
  }

  getAddressData(street: string, city: string, state: string) {
    const cacheKey = `getAddressData-${street}-${city}-${state}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        {
          lat: number;
          lon: number;
        }[]
      >(
        `https://nominatim.openstreetmap.org/search?format=json&street=${street}&city=${city}&state=${state}&country=Brazil`,
      )
      .pipe(
        take(1),
        shareReplay(1),
        catchError(() => {
          console.error(
            `Error fetching address data for ${street}, ${city}, ${state}`,
          );
          return of(null);
        }),
      );

    this.requestCache.set(cacheKey, request);

    return request;
  }

  queryDatabase(
    lat: number,
    lon: number,
    radius: number,
    before: string,
    after: string,
  ) {
    if (!lat || !lon || !radius) {
      return of(null);
    }
    const formattedBefore = this.dateService.formatYYYYMMDD(before);
    const formattedAfter = this.dateService.formatYYYYMMDD(after);

    const cacheKey = `queryDatabase-${lat}-${lon}-${radius}-${formattedBefore}-${formattedAfter}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        BoletimOcorrencia[]
      >(environment.apiUrl + `/boletins-ocorrencia/query?lat=${lat}&lon=${lon}&radius=${radius}&before=${formattedBefore}&after=${formattedAfter}`)
      .pipe(take(1), shareReplay(1));

    this.requestCache.set(cacheKey, request);

    return request;
  }

  listRubricasForPoint(
    lat: number,
    lon: number,
    radius: number,
    before: string,
    after: string,
  ) {
    if (!lat || !lon || !radius) {
      return of(null);
    }
    const formattedBefore = this.dateService.formatYYYYMMDD(before);
    const formattedAfter = this.dateService.formatYYYYMMDD(after);

    const cacheKey = `listRubricasForPoint-${lat}-${lon}-${radius}-${formattedBefore}-${formattedAfter}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        ListRubricasForPointResponse[]
      >(environment.apiUrl + `/boletins-ocorrencia/query-rubricas-for-location?lat=${lat}&lon=${lon}&radius=${radius}&before=${formattedBefore}&after=${formattedAfter}`)
      .pipe(take(1), shareReplay(1));
    this.requestCache.set(cacheKey, request);
    return request;
  }

  getBoletinsByRubricaForPoint(
    lat: number,
    lon: number,
    radius: number,
    before: string,
    after: string,
    rubrica: string,
  ) {
    if (!lat || !lon || !radius) {
      console.error(
        `Invalid parameters: lat=${lat}, lon=${lon}, radius=${radius}`,
      );
      return of(null);
    }

    const formattedBefore = this.dateService.formatYYYYMMDD(before);
    const formattedAfter = this.dateService.formatYYYYMMDD(after);

    const cacheKey = `getBoletinsByRubricaForPoint-${lat}-${lon}-${radius}-${formattedBefore}-${formattedAfter}-${rubrica}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        BoletimOcorrencia[]
      >(environment.apiUrl + `/boletins-ocorrencia/query-rubrica-in-location?lat=${lat}&lon=${lon}&radius=${radius}&before=${formattedBefore}&after=${formattedAfter}&rubrica=${rubrica}`)
      .pipe(take(1), shareReplay(1));

    this.requestCache.set(cacheKey, request);

    return request;
  }
}

export interface ListRubricasForPointResponse {
  name: string;
  count: number;
}

export interface GetBoletinsByRubricaForPointResponse {
  rubrica: string;
  latitude: number;
  longitude: number;
}
