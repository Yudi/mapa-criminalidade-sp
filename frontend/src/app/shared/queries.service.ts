import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { of, shareReplay, take, tap, Observable, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { BoletimOcorrencia } from './schema.interface';

@Injectable({
  providedIn: 'root',
})
export class QueriesService {
  private http = inject(HttpClient);
  private requestCache = new Map<string, Observable<any>>();

  checkCache(cacheKey: string) {
    return this.requestCache.has(cacheKey);
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
    const cacheKey = `queryDatabase-${lat}-${lon}-${radius}-${before}-${after}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        BoletimOcorrencia[]
      >(environment.apiUrl + `/boletins-ocorrencia/query?lat=${lat}&lon=${lon}&radius=${radius}&before=${before}&after=${after}`)
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
    const cacheKey = `listRubricasForPoint-${lat}-${lon}-${radius}-${before}-${after}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        ListRubricasForPointResponse[]
      >(environment.apiUrl + `/boletins-ocorrencia/query-rubricas-for-location?lat=${lat}&lon=${lon}&radius=${radius}&before=${before}&after=${after}`)
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

    const cacheKey = `getBoletinsByRubricaForPoint-${lat}-${lon}-${radius}-${before}-${after}-${rubrica}`;

    if (this.checkCache(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    const request = this.http
      .get<
        BoletimOcorrencia[]
      >(environment.apiUrl + `/boletins-ocorrencia/query-rubrica-in-location?lat=${lat}&lon=${lon}&radius=${radius}&before=${before}&after=${after}&rubrica=${rubrica}`)
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
