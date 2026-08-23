import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { DateService } from './date.service';
import { GraphqlClientService } from './graphql-client.service';
import { OccurrencesService } from './occurrences.service';

describe('OccurrencesService', () => {
  let service: OccurrencesService;
  let graphql: { request: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    graphql = { request: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        OccurrencesService,
        DateService,
        { provide: GraphqlClientService, useValue: graphql },
      ],
    });
    service = TestBed.inject(OccurrencesService);
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

  it('rejects non-finite coordinates without issuing a request', async () => {
    await expect(
      firstValueFrom(service.getCategoriesForLocation(Number.NaN, 0, 100))
    ).resolves.toEqual([]);
    expect(graphql.request).not.toHaveBeenCalled();
  });

  it('reuses quantized bounds and evicts old successful responses', async () => {
    graphql.request.mockImplementation(() =>
      of({ mapFeaturesCharts: { totalFeatures: 1 } })
    );

    const filter = {
      bounds: { minLon: -46.6301, minLat: -23.5501, maxLon: -46.62, maxLat: -23.54 },
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

    expect(graphql.request).toHaveBeenCalledTimes(1);

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

    expect((service as unknown as { cache: { size: number } }).cache.size).toBeLessThanOrEqual(96);
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
});
