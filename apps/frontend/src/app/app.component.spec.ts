import { provideZonelessChangeDetection } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { ptBR } from 'date-fns/locale';
import {
  CategoryInfo,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import { of, Subject, throwError } from 'rxjs';
import { AppComponent } from './app.component';
import { OccurrencesService } from './shared/occurrences.service';

describe('AppComponent', () => {
  const categories: CategoryInfo[] = [
    {
      name: 'Furto',
      count: 10,
      rubricaForStyling: 'Furto',
      sourceType: 'rubrica',
    },
  ];
  let occurrencesService: {
    getTileMetadata: jest.Mock;
    getCategoryPeriodStatsForBounds: jest.Mock;
  };

  beforeEach(async () => {
    occurrencesService = {
      getTileMetadata: jest.fn(() =>
        of({
          dateRange: {
            earliest: '2013-01-01',
            latest: '2026-04-30',
            defaultAfter: '2026-01-30',
          },
        })
      ),
      getCategoryPeriodStatsForBounds: jest.fn(() =>
        of({ categories, periods: [] })
      ),
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideDateFnsAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: ptBR },
        { provide: OccurrencesService, useValue: occurrencesService },
      ],
    }).compileComponents();
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

  it('keeps category selections when zooming below the feature threshold', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const emissions: CategoryInfo[][] = [];
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
    tick(300);
    app.onRubricasFormChange({ Furto: true });

    app.onBoundsChange({
      minLon: -48,
      minLat: -25,
      maxLon: -45,
      maxLat: -22,
      zoom: MIN_CRIME_TILE_ZOOM - 1,
    });
    tick(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);
    expect(emissions).toEqual([categories]);
    expect(app.categoriesFormValues).toEqual({ Furto: true });

    subscription.unsubscribe();
  }));

  it('refreshes statistics with the exact visible bounds after panning', fakeAsync(() => {
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
    tick(300);

    const pannedBounds = {
      minLon: -46.9,
      minLat: -23.9,
      maxLon: -45.9,
      maxLat: -22.9,
      zoom: MIN_CRIME_TILE_ZOOM,
    };
    app.onBoundsChange(pannedBounds);
    tick(300);

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
      '2026-04-30',
      '2026-01-30',
      undefined,
      undefined,
      undefined
    );
    subscription.unsubscribe();
  }));

  it('shares one statistics request between category and period filters', fakeAsync(() => {
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
    tick(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(1);

    categoriesSubscription.unsubscribe();
    periodsSubscription.unsubscribe();
  }));

  it('waits for metadata and sends the default three-month date range', fakeAsync(() => {
    const metadata = new Subject<{
      dateRange: {
        earliest: string;
        latest: string;
        defaultAfter: string;
      };
    }>();
    occurrencesService.getTileMetadata.mockReturnValue(metadata);
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
    tick(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).not.toHaveBeenCalled();

    metadata.next({
      dateRange: {
        earliest: '2013-01-01',
        latest: '2026-04-30',
        defaultAfter: '2026-01-30',
      },
    });
    tick(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      '2026-04-30',
      '2026-01-30',
      undefined,
      undefined,
      undefined
    );

    subscription.unsubscribe();
  }));

  it('keeps refreshing category filters after a failed request', fakeAsync(() => {
    occurrencesService.getCategoryPeriodStatsForBounds
      .mockReturnValueOnce(throwError(() => new Error('Request failed')))
      .mockReturnValueOnce(of({ categories, periods: [] }));
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const emissions: CategoryInfo[][] = [];
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
    tick(300);
    app.onBoundsChange({
      minLon: -49,
      minLat: -26,
      maxLon: -48,
      maxLat: -25,
      zoom: MIN_CRIME_TILE_ZOOM,
    });
    tick(300);

    expect(
      occurrencesService.getCategoryPeriodStatsForBounds
    ).toHaveBeenCalledTimes(2);
    expect(emissions).toEqual([categories]);

    subscription.unsubscribe();
  }));
});
