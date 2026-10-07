import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { DateService } from './date.service';
import { GraphqlClientService } from './graphql-client.service';
import { OccurrencesService } from './occurrences.service';
import { createRelativeDateRange } from '../testing/relative-date.fixture';

describe('OccurrencesService', () => {
  const relativeDateRange = createRelativeDateRange();
  let service: OccurrencesService;
  let graphql: {
    request: ReturnType<typeof vi.fn>;
    requestDeferred: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    graphql = { request: vi.fn(), requestDeferred: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        OccurrencesService,
        DateService,
        { provide: GraphqlClientService, useValue: graphql },
      ],
    });
    service = TestBed.inject(OccurrencesService);
  });

  it('keeps facet responses separate from complete chart responses in the cache', async () => {
    const facet = { weekdayDistribution: [{ label: 'Segunda', count: 2, filterValue: '1' }] };
    const complete = { ...facet, totalFeatures: 2, totalRecords: 3 };
    graphql.request.mockReturnValueOnce(of({ mapFeaturesCharts: facet }))
      .mockReturnValueOnce(of({ mapFeaturesCharts: complete }));

    await expect(firstValueFrom(service.getChartsForBounds({}, 'weekdays'))).resolves.toEqual(facet);
    await expect(firstValueFrom(service.getChartsForBounds({}))).resolves.toEqual(complete);
    await expect(firstValueFrom(service.getChartsForBounds({}, 'weekdays'))).resolves.toEqual(facet);
    expect(graphql.request).toHaveBeenCalledTimes(2);
    expect(graphql.request.mock.calls[0][0].query).toContain('weekdayDistribution');
    expect(graphql.request.mock.calls[0][0].query).not.toContain('totalFeatures');
    expect(graphql.request.mock.calls[0][0].query).not.toContain('categoryDistribution');
  });

  it('emits occurrence details before IML enrichment and caches only completion', () => {
    const progress = new Subject<{
      data: { mapFeatureById: unknown };
      complete: boolean;
      errors: never[];
    }>();
    graphql.requestDeferred.mockReturnValue(progress);
    const values: unknown[] = [];
    service.getFullFeatureProgressive(' feature-id ').subscribe((value) => values.push(value));
    const base = {
      dataOcorrencia: '2026-09-28',
      featureData: { location: {}, occurrence: {}, all_rubricas: [], records: [] },
    };
    progress.next({ data: { mapFeatureById: base }, complete: false, errors: [] });
    expect(values).toEqual([{
      feature: { ...base, imlRecords: [], imlUnavailable: false },
      complete: false,
      imlError: false,
    }]);
    const completed = { ...base, imlRecords: [], imlUnavailable: false };
    progress.next({ data: { mapFeatureById: completed }, complete: true, errors: [] });
    progress.complete();
    expect(values).toHaveLength(2);
    expect(values[1]).toEqual({ feature: completed, complete: true, imlError: false });

    const cached: unknown[] = [];
    service.getFullFeatureProgressive('feature-id').subscribe((value) => cached.push(value));
    expect(cached).toEqual([{ feature: completed, complete: true, imlError: false }]);
    expect(graphql.requestDeferred).toHaveBeenCalledTimes(1);
    expect(graphql.requestDeferred.mock.calls[0][0].query).toContain('@defer');
  });

  it('does not report a failed detail resolver as a missing occurrence', () => {
    graphql.requestDeferred.mockReturnValue(of({
      data: { mapFeatureById: null },
      complete: true,
      errors: [{ message: 'Internal server error' }],
    }));
    let receivedError: unknown;
    service.getFullFeatureProgressive('feature-id').subscribe({
      error: (error: unknown) => { receivedError = error; },
    });
    expect(receivedError).toEqual(new Error('Internal server error'));
  });

  it('requests monthly data separately from revision-safe comparison data', async () => {
    graphql.request.mockReturnValue(of({ mapFeaturesTemporalStats: {} }));
    await firstValueFrom(service.getTemporalStats({}, ['monthly']));
    await firstValueFrom(service.getTemporalStats({}, ['datasetRevision', 'total', 'categories']));
    const trendQuery = graphql.request.mock.calls[0][0].query;
    const comparisonQuery = graphql.request.mock.calls[1][0].query;
    expect(trendQuery).toContain('monthly { label count }');
    expect(trendQuery).not.toContain('categories');
    expect(trendQuery).not.toContain('datasetRevision');
    expect(comparisonQuery).toContain('datasetRevision');
    expect(comparisonQuery).toContain('categories { label count }');
    expect(comparisonQuery).not.toContain('monthly');
  });

  it('accepts valid zero coordinates for location queries', async () => {
    graphql.request.mockReturnValue(
      of({ mapFeaturesCategoriesForLocation: [{ name: 'Furto' }] })
    );

    await expect(
      firstValueFrom(service.getCategoriesForLocation(0, 0, 100))
    ).resolves.toEqual([{ name: 'Furto' }]);
    expect(graphql.request).toHaveBeenCalledTimes(1);
  });

  it('loads the pre-cached date range without requesting full metadata', async () => {
    graphql.request.mockReturnValue(
      of({
        mapFeaturesDateRange: relativeDateRange,
      })
    );

    await expect(firstValueFrom(service.getDateRange())).resolves.toEqual(
      relativeDateRange
    );
    expect(graphql.request).toHaveBeenCalledWith({
      query: expect.stringContaining('mapFeaturesDateRange'),
    });
    expect(graphql.request.mock.calls[0][0].query).not.toContain(
      'mapFeaturesMetadata'
    );
  });

  it('rejects non-finite coordinates without issuing a request', async () => {
    await expect(
      firstValueFrom(service.getCategoriesForLocation(Number.NaN, 0, 100))
    ).resolves.toEqual([]);
    expect(graphql.request).not.toHaveBeenCalled();
  });

  it('keeps exact viewports separate and evicts old successful responses', async () => {
    graphql.request.mockImplementation(() =>
      of({ mapFeaturesCharts: { totalFeatures: 1 } })
    );

    const filter = {
      bounds: {
        minLon: -46.6301,
        minLat: -23.5501,
        maxLon: -46.62,
        maxLat: -23.54,
      },
    };
    await firstValueFrom(service.getChartsForBounds(filter));
    await firstValueFrom(
      service.getChartsForBounds({
        bounds: {
          minLon: -46.6304,
          minLat: -23.5504,
          maxLon: -46.62,
          maxLat: -23.54,
        },
      })
    );

    expect(graphql.request).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 120; index++) {
      await firstValueFrom(
        service.getChartsForBounds({
          bounds: {
            minLon: -46 + index / 100,
            minLat: -23,
            maxLon: -45 + index / 100,
            maxLat: -22,
          },
        })
      );
    }

    expect(
      (service as unknown as { cache: { size: number } }).cache.size
    ).toBeLessThanOrEqual(96);
  });

  it('does not cache an operational error as not found', async () => {
    graphql.request
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of({ groupedOccurrenceByBo: null }));

    await expect(
      firstValueFrom(service.getOccurrencesByNumBo('123'))
    ).rejects.toThrow('offline');
    await expect(
      firstValueFrom(service.getOccurrencesByNumBo('123'))
    ).resolves.toBeNull();
    expect(graphql.request).toHaveBeenCalledTimes(2);
  });

  it('looks up feature details by stable feature id', async () => {
    graphql.request.mockReturnValue(of({ mapFeatureById: null }));

    await expect(
      firstValueFrom(service.getFullFeature('  018f-feature-id  '))
    ).resolves.toBeNull();
    expect(graphql.request).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { id: '018f-feature-id' },
      })
    );
  });
  it('sends the exact area without viewport bounds and caches different radii separately', async () => {
    graphql.request.mockReturnValue(
      of({ mapFeaturesCategoryPeriodStats: { categories: [], periods: [] } })
    );
    for (const radius of [500, 1000, 500]) {
      await firstValueFrom(
        service.getCategoryPeriodStatsForBounds(
          -47,
          -24,
          -46,
          -23,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { longitude: -46.6, latitude: -23.5, radius }
        )
      );
    }
    expect(graphql.request).toHaveBeenCalledTimes(2);
    const filter = graphql.request.mock.calls[0][0].variables.filter;
    expect(filter.bounds).toBeUndefined();
    expect(filter.area.radius).toBe(500);
  });
});
