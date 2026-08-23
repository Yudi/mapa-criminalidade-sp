import { Service, inject } from '@angular/core';
import {
  Observable,
  defer,
  finalize,
  map,
  of,
  shareReplay,
  take,
  tap,
  throwError,
} from 'rxjs';
import {
  GroupedOccurrence,
  CategoryInfo,
  GroupedOccurrenceByBoQuery,
  MapFeatureFilterInput,
  MapFeatureFullQuery,
  MapFeatureLocationInput,
  MapFeatureLookupInput,
  MapFeatureResponse,
  MapFeatureCharts,
  MapFeaturesCategoryPeriodStats,
  MapFeaturesChartsQuery,
  MapFeaturesCategoryPeriodStatsQuery,
  MapFeaturesCategoriesForLocationQuery,
  MapFeaturesMetadata,
  MapFeaturesMetadataQuery,
} from '@mapa-criminalidade/shared-types';
import { DateService } from './date.service';
import { GraphqlClientService } from './graphql-client.service';
import { BoundedTtlLruCache } from './bounded-cache';
import {
  GROUPED_OCCURRENCE_BY_BO_QUERY,
  MAP_FEATURES_CATEGORIES_FOR_LOCATION_QUERY,
  MAP_FEATURES_CATEGORY_PERIOD_STATS_QUERY,
  MAP_FEATURES_CHARTS_QUERY,
  MAP_FEATURES_METADATA_QUERY,
  MAP_FEATURE_FULL_QUERY,
} from './map-features.graphql';
import {
  parseGroupedOccurrence,
  parseMapFeatureResponse,
} from './schemas/map-feature-response.schema';
@Service()
export class OccurrencesService {
  private dateService = inject(DateService);
  private graphql = inject(GraphqlClientService);
  private readonly cache = new BoundedTtlLruCache<unknown>({
    maxEntries: 96,
    ttlMs: 5 * 60_000,
  });
  private readonly inFlight = new Map<string, Observable<unknown>>();

  getTileMetadata(): Observable<MapFeaturesMetadata> {
    return this.cachedRequest('metadata', () =>
      this.graphql
        .request<MapFeaturesMetadataQuery>({
          query: MAP_FEATURES_METADATA_QUERY,
        })
        .pipe(map((data) => data.mapFeaturesMetadata))
    );
  }
  getCategoryPeriodStatsForBounds(
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number,
    before?: string,
    after?: string,
    periods?: string[],
    startHour?: number,
    endHour?: number
  ): Observable<MapFeaturesCategoryPeriodStats> {
    if (
      ![minLon, minLat, maxLon, maxLat].every(Number.isFinite) ||
      minLon > maxLon ||
      minLat > maxLat
    ) {
      return of({ categories: [], periods: [] });
    }

    const formattedBefore = before
      ? this.dateService.formatYYYYMMDD(before)
      : '';
    const formattedAfter = after ? this.dateService.formatYYYYMMDD(after) : '';

    const filter: MapFeatureFilterInput = {
      beforeDate: formattedBefore || undefined,
      afterDate: formattedAfter || undefined,
      periods,
      startHour,
      endHour,
      bounds: { minLon, minLat, maxLon, maxLat },
    };

    const cacheKey = this.filterCacheKey('category-period-stats', filter);
    return this.cachedRequest(cacheKey, () =>
      this.graphql
        .request<
          MapFeaturesCategoryPeriodStatsQuery,
          { filter: MapFeatureFilterInput }
        >({
          query: MAP_FEATURES_CATEGORY_PERIOD_STATS_QUERY,
          variables: { filter },
        })
        .pipe(map((data) => data.mapFeaturesCategoryPeriodStats))
    );
  }

  getChartsForBounds(filter: MapFeatureFilterInput): Observable<MapFeatureCharts> {
    const cacheKey = this.filterCacheKey('charts-bounds', filter);
    return this.cachedRequest(cacheKey, () =>
      this.graphql
        .request<MapFeaturesChartsQuery, { filter: MapFeatureFilterInput }>({
          query: MAP_FEATURES_CHARTS_QUERY,
          variables: { filter },
        })
        .pipe(map((data) => data.mapFeaturesCharts))
    );
  }

  /**
   * Get categories within a geographic area
   */
  getCategoriesForLocation(
    lat: number,
    lon: number,
    radius: number,
    before?: string,
    after?: string
  ): Observable<CategoryInfo[]> {
    if (
      ![lat, lon, radius].every(Number.isFinite) ||
      radius < 1 ||
      radius > 10_000
    ) {
      return of([]);
    }

    const formattedBefore = before
      ? this.dateService.formatYYYYMMDD(before)
      : '';
    const formattedAfter = after ? this.dateService.formatYYYYMMDD(after) : '';
    const input: MapFeatureLocationInput = {
      latitude: lat,
      longitude: lon,
      radius,
      beforeDate: formattedBefore || undefined,
      afterDate: formattedAfter || undefined,
    };

    const cacheKey = this.filterCacheKey('categories', input);
    return this.cachedRequest(cacheKey, () =>
      this.graphql
        .request<
          MapFeaturesCategoriesForLocationQuery,
          { input: MapFeatureLocationInput }
        >({
          query: MAP_FEATURES_CATEGORIES_FOR_LOCATION_QUERY,
          variables: { input },
        })
        .pipe(map((data) => data.mapFeaturesCategoriesForLocation))
    );
  }
  getOccurrencesByNumBo(numBo: string): Observable<GroupedOccurrence | null> {
    const normalizedNumBo = numBo.trim();
    if (!normalizedNumBo) {
      return throwError(() => new Error('Número do BO inválido'));
    }

    return this.cachedRequest(`by-num-bo-${normalizedNumBo}`, () =>
      this.graphql
        .request<
          GroupedOccurrenceByBoQuery,
          { input: MapFeatureLookupInput }
        >({
          query: GROUPED_OCCURRENCE_BY_BO_QUERY,
          variables: { input: { numBo: normalizedNumBo } },
        })
        .pipe(map((data) => parseGroupedOccurrence(data.groupedOccurrenceByBo)))
    );
  }
  getOccurrencesByNumBoAndYear(
    numBo: string,
    anoBo: number
  ): Observable<GroupedOccurrence | null> {
    const normalizedNumBo = numBo.trim();
    if (!normalizedNumBo || !Number.isSafeInteger(anoBo)) {
      return throwError(() => new Error('Identificador do BO inválido'));
    }

    return this.cachedRequest(`by-num-bo-year-${normalizedNumBo}-${anoBo}`, () =>
      this.graphql
        .request<
          GroupedOccurrenceByBoQuery,
          { input: MapFeatureLookupInput }
        >({
          query: GROUPED_OCCURRENCE_BY_BO_QUERY,
          variables: { input: { numBo: normalizedNumBo, anoBo } },
        })
        .pipe(map((data) => parseGroupedOccurrence(data.groupedOccurrenceByBo)))
    );
  }
  getFullFeature(
    numBo: string,
    anoBo: number,
    delegacia?: string | null
  ): Observable<MapFeatureResponse | null> {
    const normalizedNumBo = numBo.trim();
    if (!normalizedNumBo || !Number.isSafeInteger(anoBo)) {
      return throwError(() => new Error('Identificador do BO inválido'));
    }

    const input: MapFeatureLookupInput = {
      numBo: normalizedNumBo,
      anoBo,
      delegacia: delegacia?.trim() || null,
    };

    return this.cachedRequest(
      this.filterCacheKey('full-feature', input),
      () =>
        this.graphql
          .request<MapFeatureFullQuery, { input: MapFeatureLookupInput }>({
            query: MAP_FEATURE_FULL_QUERY,
            variables: { input },
          })
          .pipe(map((data) => parseMapFeatureResponse(data.mapFeatureFull)))
    );
  }
  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
  clearCacheByPrefix(prefix: string): void {
    this.cache.deleteByPrefix(prefix);
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.inFlight.delete(key);
    }
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

  private filterCacheKey(prefix: string, value: unknown): string {
    return `${prefix}-${stableFilterKey(value)}`;
  }
}

const CACHE_BOUNDS_PRECISION = 100;

function stableFilterKey(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return JSON.stringify(
      [...value].map((item) => stableFilterKey(item)).sort()
    );
  }

  const record = value as Record<string, unknown>;
  const normalized = Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const current = record[key];
      if (key === 'minLon' || key === 'maxLon' || key === 'minLat' || key === 'maxLat') {
        result[key] =
          typeof current === 'number'
            ? Math.round(current * CACHE_BOUNDS_PRECISION) / CACHE_BOUNDS_PRECISION
            : current;
      } else if (Array.isArray(current)) {
        result[key] = [...current].filter(Boolean).sort();
      } else if (current && typeof current === 'object') {
        result[key] = JSON.parse(stableFilterKey(current));
      } else {
        result[key] = current;
      }
      return result;
    }, {});

  return JSON.stringify(normalized);
}
