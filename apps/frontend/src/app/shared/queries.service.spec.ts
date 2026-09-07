import {
  provideHttpClient,
  withXhr,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { DateService } from './date.service';
import { GraphqlClientService } from './graphql-client.service';
import {
  AddressSearchInputError,
  QueriesService,
} from './queries.service';
import { OccurrencesService } from './occurrences.service';

describe('QueriesService', () => {
  let service: QueriesService;
  let http: HttpTestingController;
  let occurrences: { getCategoriesForLocation: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    occurrences = {
      getCategoriesForLocation: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        QueriesService,
        DateService,
        { provide: OccurrencesService, useValue: occurrences },
        { provide: GraphqlClientService, useValue: { request: vi.fn() } },
      ],
    });
    service = TestBed.inject(QueriesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('caps address input and does not send an overlong query', async () => {
    await expect(
      firstValueFrom(service.getAddressData('x'.repeat(161), '', 'São Paulo'))
    ).rejects.toBeInstanceOf(AddressSearchInputError);
    expect(() =>
      http.expectOne((request) => request.url.includes('/geocoding/search'))
    ).toThrow();
  });

  it('normalizes address whitespace and retains only bounded hashed cache keys', async () => {
    const request = firstValueFrom(
      service.getAddressData('  Rua   A  ', ' São Paulo ', ' São Paulo ')
    );
    const pending = http.expectOne((request) =>
      request.url.includes('/geocoding/search')
    );
    expect(pending.request.params.get('street')).toBe('Rua A');
    expect(pending.request.params.get('city')).toBe('São Paulo');
    pending.flush([{ lat: '-23.5', lon: '-46.6' }]);
    await expect(request).resolves.toEqual([{ lat: -23.5, lon: -46.6 }]);

    const cache = service as unknown as {
      cache: { size: number };
      inFlight: Map<string, unknown>;
    };
    expect(cache.cache.size).toBe(1);
    expect([...cache.inFlight.keys()].some((key) => key.includes('Rua'))).toBe(
      false
    );
  });

  it('cancels an older pending search before serving a newer cached result', async () => {
    vi.useFakeTimers();

    const cachedLookup = firstValueFrom(
      service.getAddressData('Rua B', 'São Paulo', 'São Paulo')
    );
    const cachedRequest = http.expectOne((request) =>
      request.url.includes('/geocoding/search')
    );
    cachedRequest.flush([{ lat: '-23.5', lon: '-46.6' }]);
    await expect(cachedLookup).resolves.toEqual([{ lat: -23.5, lon: -46.6 }]);

    vi.advanceTimersByTime(1001);
    const olderValues: { lat: number; lon: number }[] = [];
    let olderCompleted = false;
    service
      .getAddressData('Rua A', 'São Paulo', 'São Paulo')
      .subscribe({
        next: (value) => {
          if (value) olderValues.push(...value);
        },
        complete: () => {
          olderCompleted = true;
        },
      });
    const olderRequest = http.expectOne((request) =>
      request.url.includes('/geocoding/search') &&
      request.params.get('street') === 'Rua A'
    );

    vi.advanceTimersByTime(1001);
    await expect(
      firstValueFrom(service.getAddressData('Rua B', 'São Paulo', 'São Paulo'))
    ).resolves.toEqual([{ lat: -23.5, lon: -46.6 }]);

    expect(olderCompleted).toBe(true);
    expect(olderValues).toEqual([]);
    expect(olderRequest.cancelled).toBe(true);
  });

  it('returns valid zero coordinates through the deprecated location path', async () => {
    const result = firstValueFrom(
      service.listRubricasForPoint(0, 0, 100, '', '')
    );
    await expect(result).resolves.toEqual([]);
    expect(occurrences.getCategoriesForLocation).toHaveBeenCalledWith(
      0,
      0,
      100,
      '',
      ''
    );
  });
});
