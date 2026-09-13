import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ptBR } from 'date-fns/locale';
import {
  CategoryInfo,
  DateRange,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import { of, Subject, throwError } from 'rxjs';
import { AppComponent } from './app.component';
import { OccurrencesService } from './shared/occurrences.service';
import { VectorTileService } from './shared/vector-tile.service';
import { createRelativeDateRange } from './testing/relative-date.fixture';

describe('AppComponent', () => {
  const relativeDateRange = createRelativeDateRange();
  const categories: CategoryInfo[] = [
    {
      name: 'Furto',
      count: 10,
      rubricaForStyling: 'Furto',
      sourceType: 'rubrica',
    },
  ];
  let occurrencesService: {
    getTileMetadata: ReturnType<typeof vi.fn>;
    getDateRange: ReturnType<typeof vi.fn>;
    getCategoryPeriodStatsForBounds: ReturnType<typeof vi.fn>;
    clearCache: ReturnType<typeof vi.fn>;
    clearCacheByPrefix: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    occurrencesService = {
      getDateRange: vi.fn(() => of(relativeDateRange)),
      getTileMetadata: vi.fn(() =>
        of({
          dateRange: relativeDateRange,
        })
      ),
      getCategoryPeriodStatsForBounds: vi.fn(() =>
        of({ categories, periods: [] })
      ),
      clearCache: vi.fn(),
      clearCacheByPrefix: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideDateFnsAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: ptBR },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: OccurrencesService, useValue: occurrencesService },
        {
          provide: VectorTileService,
          useValue: { clearMetadataCache: vi.fn() },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'frontend' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('frontend');
  });

  it('should render the search filters section', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('section[aria-label="Filtros de pesquisa"]')
    ).not.toBeNull();
  });

  it('keeps category selections when zooming below the feature threshold', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const emissions: Omit<CategoryInfo, 'sourceType'>[][] = [];
    const subscription = app.categories.subscribe((value) =>
      emissions.push(value)
    );

    app.onBoundsChange({
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    });
    vi.advanceTimersByTime(300);
    app.onRubricasFormChange({ Furto: true });

    app.onBoundsChange({
      minLon: -48,
      minLat: -25,
      maxLon: -45,
      maxLat: -22,
      zoom: MIN_CRIME_TILE_ZOOM - 1,
    });
    vi.advanceTimersByTime(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);
    expect(emissions).toEqual([categories]);
    expect(app.categoriesFormValues).toEqual({ Furto: true });

    subscription.unsubscribe();
  });

  it('refreshes statistics with the exact visible bounds after panning', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const subscription = app.categories.subscribe();

    const initialBounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    };
    app.onBoundsChange(initialBounds);
    vi.advanceTimersByTime(300);

    const pannedBounds = {
      minLon: -46.9,
      minLat: -23.9,
      maxLon: -45.9,
      maxLat: -22.9,
      zoom: MIN_CRIME_TILE_ZOOM,
    };
    app.onBoundsChange(pannedBounds);
    vi.advanceTimersByTime(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(2);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenLastCalledWith(
      pannedBounds.minLon,
      pannedBounds.minLat,
      pannedBounds.maxLon,
      pannedBounds.maxLat,
      relativeDateRange.latest,
      relativeDateRange.defaultAfter,
      undefined,
      undefined,
      undefined,
      undefined,
      {}
    );
    subscription.unsubscribe();
  });

  it('cancels the previous statistics request as soon as the map moves', () => {
    vi.useFakeTimers();
    const initialRequest = new Subject<{
      categories: CategoryInfo[];
      periods: [];
    }>();
    occurrencesService.getCategoryPeriodStatsForBounds
      .mockReturnValueOnce(initialRequest)
      .mockReturnValueOnce(of({ categories, periods: [] }));
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const subscription = app.categories.subscribe();
    const initialBounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    };

    app.onBoundsChange(initialBounds);
    vi.advanceTimersByTime(300);
    expect(initialRequest.observed).toBe(true);

    app.onBoundsChange({ ...initialBounds, minLon: -48 });

    expect(initialRequest.observed).toBe(false);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);
    expect(app.statsError()).toBe(false);

    vi.advanceTimersByTime(300);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(2);

    subscription.unsubscribe();
  });

  it('does not cancel a pending statistics request for duplicate bounds', () => {
    vi.useFakeTimers();
    const pending = new Subject<{
      categories: CategoryInfo[];
      periods: [];
    }>();
    occurrencesService.getCategoryPeriodStatsForBounds.mockReturnValueOnce(
      pending
    );
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const emissions: Omit<CategoryInfo, 'sourceType'>[][] = [];
    const subscription = app.categories.subscribe((value) =>
      emissions.push(value)
    );
    const bounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    };

    app.onBoundsChange(bounds);
    vi.advanceTimersByTime(300);
    app.onBoundsChange({ ...bounds });

    expect(pending.observed).toBe(true);
    vi.advanceTimersByTime(300);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);

    pending.next({ categories, periods: [] });
    pending.complete();
    expect(emissions).toEqual([categories]);
    expect(app.viewportStatsLoading()).toBe(false);
    subscription.unsubscribe();
  });

  it('shares one statistics request between category and period filters', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const categoriesSubscription = app.categories.subscribe();
    const periodsSubscription = app.periods.subscribe();

    app.onBoundsChange({
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    });
    vi.advanceTimersByTime(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);

    categoriesSubscription.unsubscribe();
    periodsSubscription.unsubscribe();
  });

  it('waits for the pre-cached date range and sends the bounded initial lookup', () => {
    vi.useFakeTimers();
    const dateRangeSubject = new Subject<DateRange>();
    occurrencesService.getDateRange.mockReturnValue(dateRangeSubject);
    occurrencesService.getTileMetadata.mockReturnValue(new Subject());
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const subscription = app.categories.subscribe();

    app.onBoundsChange({
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    });
    vi.advanceTimersByTime(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).not.toHaveBeenCalled();

    dateRangeSubject.next(relativeDateRange);
    vi.advanceTimersByTime(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      relativeDateRange.latest,
      relativeDateRange.defaultAfter,
      undefined,
      undefined,
      undefined,
      undefined,
      {}
    );

    subscription.unsubscribe();
  });

  it('keeps refreshing category filters after a failed request', () => {
    vi.useFakeTimers();
    occurrencesService.getCategoryPeriodStatsForBounds
      .mockReturnValueOnce(throwError(() => new Error('Request failed')))
      .mockReturnValueOnce(of({ categories, periods: [] }));
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const emissions: Omit<CategoryInfo, 'sourceType'>[][] = [];
    const subscription = app.categories.subscribe((value) =>
      emissions.push(value)
    );

    app.onBoundsChange({
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    });
    vi.advanceTimersByTime(300);
    app.onBoundsChange({
      minLon: -49,
      minLat: -26,
      maxLon: -48,
      maxLat: -25,
      zoom: MIN_CRIME_TILE_ZOOM,
    });
    vi.advanceTimersByTime(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(2);
    expect(emissions).toEqual([categories]);

    subscription.unsubscribe();
  });

  it('does not resync the map when viewport stats re-emit the same selection', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const syncSpy = vi.spyOn(
      app as unknown as { syncMapInputs: () => void },
      'syncMapInputs'
    );

    app.onRubricasFormChange({ Furto: true });
    app.onRubricasFormChange({ Furto: true });

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a retry state when metadata fails and recovers without reload', () => {
    occurrencesService.getTileMetadata
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(
        of({
          dateRange: relativeDateRange,
          datasetRevision: 'revision-b',
        })
      );
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    expect(app.metadataLoadError()).toBe(true);

    app.retryMetadata();

    expect(app.metadataLoadError()).toBe(false);
    expect(app.datasetRevision).toBe('revision-b');
    expect(occurrencesService.getTileMetadata).toHaveBeenCalledTimes(2);
  });

  it('retries failed metadata on pan and clears the error only after recovery', () => {
    const recoveredMetadata = new Subject<{
      dateRange: DateRange;
      datasetRevision: string;
    }>();
    occurrencesService.getTileMetadata
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(throwError(() => new Error('still offline')))
      .mockReturnValueOnce(recoveredMetadata);
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const bounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: MIN_CRIME_TILE_ZOOM,
    };

    app.onBoundsChange(bounds);
    expect(app.metadataLoadError()).toBe(true);
    expect(app.metadataLoading()).toBe(false);

    app.onBoundsChange({ ...bounds, minLon: -48 });
    expect(app.metadataLoadError()).toBe(true);
    expect(app.metadataLoading()).toBe(true);

    app.onBoundsChange({ ...bounds, minLon: -49 });
    expect(occurrencesService.getTileMetadata).toHaveBeenCalledTimes(3);

    recoveredMetadata.next({
      dateRange: relativeDateRange,
      datasetRevision: 'recovered-revision',
    });
    expect(app.metadataLoadError()).toBe(false);
    expect(app.metadataLoading()).toBe(false);
    expect(app.datasetRevision).toBe('recovered-revision');

    app.onBoundsChange({ ...bounds, minLon: -50 });
    expect(occurrencesService.getTileMetadata).toHaveBeenCalledTimes(3);
  });
  it('keeps exact-area statistics fixed while panning and restores viewport queries when cleared', () => {
    vi.useFakeTimers();
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const subscription = app.categories.subscribe();
    const bounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: 12,
    };
    const area = { longitude: -46.6, latitude: -23.5, radius: 500 };
    app.onBoundsChange(bounds);
    app.onAreaChange(area);
    vi.advanceTimersByTime(300);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds.mock.calls[0][9]
    ).toEqual(area);
    app.onBoundsChange({ ...bounds, minLon: -48, zoom: 8 });
    vi.advanceTimersByTime(300);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);
    app.onRubricasFormChange({ Furto: true });
    expect(app.canOpenVisibleCharts).toBe(true);
    app.onAreaChange(null);
    vi.advanceTimersByTime(300);
    expect(app.canLoadStats).toBe(false);
    expect(app.canOpenVisibleCharts).toBe(false);
    expect(app.viewportStatsLoading()).toBe(false);
    app.onBoundsChange(bounds);
    vi.advanceTimersByTime(300);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(2);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds.mock.calls[1][9]
    ).toBeUndefined();
    subscription.unsubscribe();
  });

  it('keeps a pending exact-area statistics request while panning', () => {
    vi.useFakeTimers();
    const pending = new Subject<{
      categories: CategoryInfo[];
      periods: [];
    }>();
    occurrencesService.getCategoryPeriodStatsForBounds.mockReturnValueOnce(
      pending
    );
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const emissions: Omit<CategoryInfo, 'sourceType'>[][] = [];
    const subscription = app.categories.subscribe((value) =>
      emissions.push(value)
    );
    const bounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: 12,
    };

    app.onBoundsChange(bounds);
    app.onAreaChange({ longitude: -46.6, latitude: -23.5, radius: 500 });
    vi.advanceTimersByTime(300);
    app.onBoundsChange({ ...bounds, minLon: -48 });

    expect(pending.observed).toBe(true);
    vi.advanceTimersByTime(300);
    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);

    pending.next({ categories, periods: [] });
    pending.complete();
    expect(emissions).toEqual([categories]);
    expect(app.viewportStatsLoading()).toBe(false);
    subscription.unsubscribe();
  });

  it('does not expose a previous scope response during the area debounce', () => {
    vi.useFakeTimers();
    const pending = new Subject<{ categories: CategoryInfo[]; periods: [] }>();
    occurrencesService.getCategoryPeriodStatsForBounds.mockReturnValueOnce(
      pending
    );
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const emissions: Omit<CategoryInfo, 'sourceType'>[][] = [];
    const subscription = app.categories.subscribe((value) =>
      emissions.push(value)
    );
    app.onBoundsChange({
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      zoom: 12,
    });
    vi.advanceTimersByTime(300);
    app.onAreaChange({ longitude: -46.6, latitude: -23.5, radius: 500 });
    pending.next({ categories, periods: [] });
    expect(emissions).toEqual([]);
    expect(app.viewportStatsLoading()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(emissions).toEqual([categories]);
    subscription.unsubscribe();
  });
});
