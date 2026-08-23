import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import {
  defer,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  Subject,
  take,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import {
  GroupedOccurrence,
} from '@mapa-criminalidade/shared-types';
import { DateService } from './date.service';
import { OccurrencesService } from './occurrences.service';
import { BoundedTtlLruCache } from './bounded-cache';

interface AddressCoordinate {
  lat: number;
  lon: number;
}

interface NominatimAddressResult {
  lat: string;
  lon: string;
}

const MAX_STREET_LENGTH = 160;
const MAX_CITY_LENGTH = 100;
const MAX_STATE_LENGTH = 80;
const MAX_ADDRESS_REQUESTS_PER_SECOND = 4;
const ADDRESS_CACHE_TTL_MS = 5 * 60_000;
const ADDRESS_CACHE_MAX_ENTRIES = 48;

export class AddressSearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressSearchInputError';
  }
}

@Service()
export class QueriesService {
  private http = inject(HttpClient);
  private dateService = inject(DateService);
  private occurrencesService = inject(OccurrencesService);

  private readonly cache = new BoundedTtlLruCache<unknown>({
    maxEntries: ADDRESS_CACHE_MAX_ENTRIES,
    ttlMs: ADDRESS_CACHE_TTL_MS,
  });
  private readonly inFlight = new Map<string, Observable<unknown>>();
  private readonly addressCancellation$ = new Subject<void>();
  private lastAddressRequestAt = 0;

  getAddressData(
    street: string,
    city: string,
    state: string
  ): Observable<AddressCoordinate[] | null> {
    let normalized: NormalizedAddressInput | null;
    try {
      normalized = normalizeAddressInput(street, city, state);
    } catch (error) {
      return throwError(() => error);
    }
    if (!normalized) {
      return throwError(
        () => new AddressSearchInputError('Informe uma via ou uma cidade.')
      );
    }

    const cacheKey = `address-${hashAddressInput(normalized)}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return of(cached as AddressCoordinate[]);

    const now = Date.now();
    if (
      now - this.lastAddressRequestAt <
      1000 / MAX_ADDRESS_REQUESTS_PER_SECOND
    ) {
      return throwError(
        () =>
          new AddressSearchInputError(
            'Aguarde um instante antes de buscar outro endereço.'
          )
      );
    }
    this.lastAddressRequestAt = now;
    this.addressCancellation$.next();

    const params = new HttpParams()
      .set('format', 'json')
      .set('street', normalized.street)
      .set('city', normalized.city)
      .set('state', normalized.state)
      .set('country', 'Brazil');

    return this.cachedRequest(cacheKey, () =>
      this.http
        .get<NominatimAddressResult[]>(
          'https://nominatim.openstreetmap.org/search',
          { params }
        )
        .pipe(
          map((results) => {
            if (!Array.isArray(results)) {
              throw new Error('Invalid address search response');
            }

            return results
              .map((result) => ({
                lat: Number(result.lat),
                lon: Number(result.lon),
              }))
              .filter(
                (coordinate) =>
                  Number.isFinite(coordinate.lat) &&
                  Number.isFinite(coordinate.lon)
              );
          }),
          takeUntil(this.addressCancellation$)
        )
    );
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
    if (
      ![lat, lon, radius].every(Number.isFinite) ||
      radius < 1 ||
      radius > 10_000
    ) {
      return of(null);
    }
    const formattedBefore = before
      ? this.dateService.formatYYYYMMDD(before)
      : '';
    const formattedAfter = after ? this.dateService.formatYYYYMMDD(after) : '';

    const cacheKey = `listRubricasForPoint-${lat}-${lon}-${radius}-${formattedBefore}-${formattedAfter}`;

    return this.cachedRequest(cacheKey, () =>
      this.occurrencesService
        .getCategoriesForLocation(
          lat,
          lon,
          radius,
          formattedBefore,
          formattedAfter
        )
        .pipe(map((categories) => categories))
    );
  }

  /**
   * @deprecated Use OccurrencesService.getOccurrencesByNumBo() instead
   */
  getBoletimByNumBo(numBo: string): Observable<GroupedOccurrence | null> {
    const cacheKey = `getBoletimByNumBo-${numBo}`;

    return this.cachedRequest(cacheKey, () =>
      this.occurrencesService
        .getOccurrencesByNumBo(numBo)
        .pipe(map((occurrence) => occurrence))
    );
  }

  private cachedRequest<T>(
    cacheKey: string,
    factory: () => Observable<T>
  ): Observable<T> {
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return of(cached as T);

    const pending = this.inFlight.get(cacheKey) as Observable<T> | undefined;
    if (pending) return pending;

    const request = defer(factory).pipe(
      take(1),
      tap((value) => this.cache.set(cacheKey, value)),
      finalize(() => {
        if (this.inFlight.get(cacheKey) === request) {
          this.inFlight.delete(cacheKey);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.inFlight.set(cacheKey, request);
    return request;
  }
}

type NormalizedAddressInput = {
  street: string;
  city: string;
  state: string;
};

function normalizeAddressInput(
  street: string,
  city: string,
  state: string
): NormalizedAddressInput | null {
  const normalized = {
    street: normalizeAddressPart(street, MAX_STREET_LENGTH),
    city: normalizeAddressPart(city, MAX_CITY_LENGTH),
    state: normalizeAddressPart(state, MAX_STATE_LENGTH),
  };

  if (!normalized.street && !normalized.city) return null;
  return normalized;
}

function normalizeAddressPart(value: string, maxLength: number): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  if (normalized.length > maxLength) {
    throw new AddressSearchInputError(
      `O texto do endereço deve ter no máximo ${maxLength} caracteres.`
    );
  }
  if (containsControlCharacters(normalized)) {
    throw new AddressSearchInputError(
      'O endereço contém caracteres inválidos.'
    );
  }
  return normalized;
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hashAddressInput(input: NormalizedAddressInput): string {
  const value = `${input.street}\u001f${input.city}\u001f${input.state}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
