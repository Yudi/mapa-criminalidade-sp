import { Injectable, inject } from '@angular/core';
import { Observable, of, shareReplay, take, catchError, map } from 'rxjs';
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
@Injectable({
  providedIn: 'root',
})
export class OccurrencesService {
  private dateService = inject(DateService);
  private graphql = inject(GraphqlClientService);
  private cache = new Map<string, Observable<unknown>>();
  private metadataCache$: Observable<MapFeaturesMetadata> | null = null;
  getTileMetadata(): Observable<MapFeaturesMetadata> {
    if (!this.metadataCache$) {
      this.metadataCache$ = this.graphql
        .request<MapFeaturesMetadataQuery>({
          query: MAP_FEATURES_METADATA_QUERY,
        })
        .pipe(
          map((data) => data.mapFeaturesMetadata),
          take(1),
          shareReplay(1)
        );
    }
    return this.metadataCache$;
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
      minLon === undefined ||
      minLat === undefined ||
      maxLon === undefined ||
      maxLat === undefined
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

    const cacheKey = `category-period-stats-${JSON.stringify(filter)}`;
    const cached = this.cache.get(cacheKey) as
      | Observable<MapFeaturesCategoryPeriodStats>
      | undefined;
    if (cached) return cached;

    const request = this.graphql
      .request<
        MapFeaturesCategoryPeriodStatsQuery,
        { filter: MapFeatureFilterInput }
      >({
        query: MAP_FEATURES_CATEGORY_PERIOD_STATS_QUERY,
        variables: { filter },
      })
      .pipe(
        map((data) => data.mapFeaturesCategoryPeriodStats),
        take(1),
        shareReplay(1)
      );

    this.cache.set(cacheKey, request);
    return request;
  }

  getChartsForBounds(filter: MapFeatureFilterInput): Observable<MapFeatureCharts> {
    const cacheKey = `charts-bounds-${JSON.stringify(filter)}`;
    const cached = this.cache.get(cacheKey) as
      | Observable<MapFeatureCharts>
      | undefined;
    if (cached) return cached;

    const request = this.graphql
      .request<MapFeaturesChartsQuery, { filter: MapFeatureFilterInput }>({
        query: MAP_FEATURES_CHARTS_QUERY,
        variables: { filter },
      })
      .pipe(
        map((data) => data.mapFeaturesCharts),
        take(1),
        shareReplay(1)
      );

    this.cache.set(cacheKey, request);
    return request;
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
    if (!lat || !lon || !radius) {
      return of([]);
    }

    const formattedBefore = before
      ? this.dateService.formatYYYYMMDD(before)
      : '';
    const formattedAfter = after ? this.dateService.formatYYYYMMDD(after) : '';
    const cacheKey = `categories-${lat}-${lon}-${radius}-${formattedBefore}-${formattedAfter}`;

    const cached = this.cache.get(cacheKey) as
      | Observable<CategoryInfo[]>
      | undefined;
    if (cached) return cached;

    const input: MapFeatureLocationInput = {
      latitude: lat,
      longitude: lon,
      radius,
      beforeDate: formattedBefore || undefined,
      afterDate: formattedAfter || undefined,
    };

    const request = this.graphql
      .request<
        MapFeaturesCategoriesForLocationQuery,
        { input: MapFeatureLocationInput }
      >({
        query: MAP_FEATURES_CATEGORIES_FOR_LOCATION_QUERY,
        variables: { input },
      })
      .pipe(
        map((data) => data.mapFeaturesCategoriesForLocation),
        take(1),
        shareReplay(1)
      );

    this.cache.set(cacheKey, request);
    return request;
  }
  getOccurrencesByNumBo(numBo: string): Observable<GroupedOccurrence | null> {
    const cacheKey = `by-num-bo-${numBo}`;
    const cached = this.cache.get(cacheKey) as
      | Observable<GroupedOccurrence | null>
      | undefined;
    if (cached) return cached;

    const request = this.graphql
      .request<
        GroupedOccurrenceByBoQuery,
        { input: MapFeatureLookupInput }
      >({
        query: GROUPED_OCCURRENCE_BY_BO_QUERY,
        variables: { input: { numBo } },
      })
      .pipe(
        map((data) => parseGroupedOccurrence(data.groupedOccurrenceByBo)),
        take(1),
        shareReplay(1),
        catchError(() => of(null))
      );

    this.cache.set(cacheKey, request);
    return request;
  }
  getOccurrencesByNumBoAndYear(
    numBo: string,
    anoBo: number
  ): Observable<GroupedOccurrence | null> {
    const cacheKey = `by-num-bo-year-${numBo}-${anoBo}`;
    const cached = this.cache.get(cacheKey) as
      | Observable<GroupedOccurrence | null>
      | undefined;
    if (cached) return cached;

    const request = this.graphql
      .request<
        GroupedOccurrenceByBoQuery,
        { input: MapFeatureLookupInput }
      >({
        query: GROUPED_OCCURRENCE_BY_BO_QUERY,
        variables: { input: { numBo, anoBo } },
      })
      .pipe(
        map((data) => parseGroupedOccurrence(data.groupedOccurrenceByBo)),
        take(1),
        shareReplay(1),
        catchError(() => of(null))
      );

    this.cache.set(cacheKey, request);
    return request;
  }
  getFullFeature(
    numBo: string,
    anoBo: number,
    delegacia?: string | null
  ): Observable<MapFeatureResponse | null> {
    const cacheKey = `full-feature-${numBo}-${anoBo}-${delegacia ?? ''}`;
    const cached = this.cache.get(cacheKey) as
      | Observable<MapFeatureResponse | null>
      | undefined;
    if (cached) return cached;

    const input: MapFeatureLookupInput = {
      numBo,
      anoBo,
      delegacia: delegacia ?? null,
    };

    const request = this.graphql
      .request<MapFeatureFullQuery, { input: MapFeatureLookupInput }>({
        query: MAP_FEATURE_FULL_QUERY,
        variables: { input },
      })
      .pipe(
        map((data) => parseMapFeatureResponse(data.mapFeatureFull)),
        take(1),
        shareReplay(1),
        catchError(() => of(null))
      );

    this.cache.set(cacheKey, request);
    return request;
  }
  clearCache(): void {
    this.cache.clear();
    this.metadataCache$ = null;
  }
  clearCacheByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}
