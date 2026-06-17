import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentRef,
  computed,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  ViewContainerRef,
  inject,
  signal,
} from '@angular/core';
import { CardComponent } from './components/card/card.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';

import { isPlatformBrowser } from '@angular/common';
import { MatIconRegistry } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import DataFormValues from './shared/dataForm.interface';
import { QueriesService } from './shared/queries.service';
import { OccurrencesService } from './shared/occurrences.service';
import { DateService } from './shared/date.service';
import { ProgressBarService } from './shared/progressbar.service';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs';
import {
  CategoryInfo,
  DateRange,
  MapFeatureFilterInput,
  MIN_CRIME_TILE_ZOOM,
  PeriodInfo,
} from '@mapa-criminalidade/shared-types';
export interface MapBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  zoom: number;
}

type DateFilters = { before: string | null; after: string | null };
type HourFilter = { enabled: boolean; startHour: number; endHour: number };
type SubscriptionLike = { unsubscribe: () => void };
type DynamicMapComponent = {
  boundsChange: {
    subscribe: (callback: (bounds: MapBounds) => void) => SubscriptionLike;
  };
};
@Component({
  selector: 'app-root',
  imports: [CardComponent, ToolbarComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements AfterViewInit, OnDestroy {
  title = 'frontend';
  private platformId = inject(PLATFORM_ID);
  private queriesService = inject(QueriesService);
  private occurrencesService = inject(OccurrencesService);
  private iconRegistry = inject(MatIconRegistry);
  private dateService = inject(DateService);
  private dialog = inject(MatDialog);
  private progressBarService = inject(ProgressBarService);
  private changeDetectorRef = inject(ChangeDetectorRef);
  categories: Observable<CategoryInfo[]> = of([]);
  periods: Observable<PeriodInfo[]> = of([]);
  categoriesFormValues: { [key: string]: boolean } | undefined;

  dateRange: DateRange | null = null;

  showIndeterminateProgressBar = signal(false);
  isProgressBarVisible = computed(
    () =>
      this.showIndeterminateProgressBar() || this.progressBarService.isLoading()
  );
  progressBarPercentage = signal(-1);
  viewportStatsLoading = signal(false);
  addressCenter: {
    lon: number | null;
    lat: number | null;
  } = {
    lon: null,
    lat: null,
  };

  dateFilters: DateFilters = { before: null, after: null };
  periodFilter: string | null = null;
  hourFilter: HourFilter = { enabled: false, startHour: 0, endHour: 23 };
  private boundsSubject = new BehaviorSubject<MapBounds | null>(null);
  // Do not emit until metadata provides the bounded default date range.
  private dateFiltersSubject = new ReplaySubject<DateFilters>(1);
  private periodFilterSubject = new BehaviorSubject<string | null>(
    this.periodFilter
  );
  private hourFilterSubject = new BehaviorSubject<HourFilter>(this.hourFilter);
  currentBounds: MapBounds | null = null;
  isMapComponentLoaded = signal(false);
  private isDestroyed = false;
  private mapComponentRef: ComponentRef<DynamicMapComponent> | null = null;
  private mapBoundsSubscription: SubscriptionLike | null = null;

  @ViewChild('mapOutlet', { read: ViewContainerRef })
  private mapOutlet?: ViewContainerRef;

  get isBrowserOnly(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  get canOpenVisibleCharts(): boolean {
    const selectedCategories = this.selectedCategories();

    return Boolean(
      this.currentBounds &&
        this.currentBounds.zoom >= MIN_CRIME_TILE_ZOOM &&
        selectedCategories.length > 0
    );
  }

  constructor() {
    this.iconRegistry.setDefaultFontSetClass('material-symbols-outlined');

    if (this.isBrowserOnly) {
      this.occurrencesService
        .getTileMetadata()
        .pipe(take(1))
        .subscribe({
          next: (metadata) => {
            this.dateRange = metadata.dateRange;

            if (!this.dateFilters.before && !this.dateFilters.after) {
              const defaultAfterDate = this.dateService.defaultAfterDate(
                metadata.dateRange
              );
              this.dateFilters = {
                after:
                  this.dateService.formatYYYYMMDD(defaultAfterDate) || null,
                before: metadata.dateRange.latest,
              };
              this.dateFiltersSubject.next(this.dateFilters);
              this.syncMapInputs();
            }

            this.changeDetectorRef.markForCheck();
          },
          error: (error: unknown) => {
            console.error('Error loading map metadata:', error);
            this.changeDetectorRef.markForCheck();
          },
        });
    }
    const categoryPeriodStats = combineLatest([
      this.boundsSubject,
      this.dateFiltersSubject,
      this.periodFilterSubject,
      this.hourFilterSubject,
    ]).pipe(
      debounceTime(300),
      distinctUntilChanged(
        (prev, curr) =>
          prev[0]?.minLon === curr[0]?.minLon &&
          prev[0]?.minLat === curr[0]?.minLat &&
          prev[0]?.maxLon === curr[0]?.maxLon &&
          prev[0]?.maxLat === curr[0]?.maxLat &&
          prev[0]?.zoom === curr[0]?.zoom &&
          prev[1].before === curr[1].before &&
          prev[1].after === curr[1].after &&
          prev[2] === curr[2] &&
          prev[3].enabled === curr[3].enabled &&
          prev[3].startHour === curr[3].startHour &&
          prev[3].endHour === curr[3].endHour
      ),
      switchMap(([bounds, dateFilters, periodFilter, hourFilter]) => {
        if (!bounds || bounds.zoom < MIN_CRIME_TILE_ZOOM) {
          this.viewportStatsLoading.set(false);
          return EMPTY;
        }
        this.viewportStatsLoading.set(true);
        return this.occurrencesService
          .getCategoryPeriodStatsForBounds(
            bounds.minLon,
            bounds.minLat,
            bounds.maxLon,
            bounds.maxLat,
            dateFilters.before ?? undefined,
            dateFilters.after ?? undefined,
            periodFilter ? [periodFilter] : undefined,
            hourFilter.enabled ? hourFilter.startHour : undefined,
            hourFilter.enabled ? hourFilter.endHour : undefined
          )
          .pipe(
            tap(() => this.viewportStatsLoading.set(false)),
            catchError((error: unknown) => {
              this.viewportStatsLoading.set(false);
              console.error(
                'Error loading category and period statistics for map bounds:',
                error
              );
              return EMPTY;
            })
          );
      }),
      shareReplay(1)
    );

    this.categories = categoryPeriodStats.pipe(map((stats) => stats.categories));
    this.periods = categoryPeriodStats.pipe(map((stats) => stats.periods));
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowserOnly || !this.mapOutlet) return;

    const { MapComponent } = await import('./components/map/map.component');

    if (this.isDestroyed) return;

    this.mapComponentRef = this.mapOutlet.createComponent(MapComponent);
    this.mapBoundsSubscription =
      this.mapComponentRef.instance.boundsChange.subscribe((bounds) =>
        this.onBoundsChange(bounds)
      );
    this.syncMapInputs();
    this.isMapComponentLoaded.set(true);
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.mapBoundsSubscription?.unsubscribe();
    this.mapComponentRef?.destroy();
    this.mapBoundsSubscription = null;
    this.mapComponentRef = null;
  }

  onRubricasFormChange(rubricasFormValues: { [key: string]: boolean }) {
    this.categoriesFormValues = rubricasFormValues;
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }

  onPeriodFilterChange(period: string | null) {
    this.periodFilter = period;
    this.periodFilterSubject.next(period);
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }

  onHourFilterChange(hourFilter: HourFilter) {
    this.hourFilter = hourFilter;
    this.hourFilterSubject.next(hourFilter);
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }
  onBoundsChange(bounds: MapBounds) {
    this.currentBounds = bounds;
    this.boundsSubject.next(bounds);
    this.changeDetectorRef.markForCheck();
  }

  async onVisibleChartsClick(): Promise<void> {
    const bounds = this.currentBounds;
    if (!bounds || !this.canOpenVisibleCharts) return;

    const filter: MapFeatureFilterInput = {
      beforeDate: this.dateFilters.before ?? undefined,
      afterDate: this.dateFilters.after ?? undefined,
      categories: this.selectedCategories(),
      periods: this.periodFilter ? [this.periodFilter] : undefined,
      startHour: this.hourFilter.enabled ? this.hourFilter.startHour : undefined,
      endHour: this.hourFilter.enabled ? this.hourFilter.endHour : undefined,
      bounds: {
        minLon: bounds.minLon,
        minLat: bounds.minLat,
        maxLon: bounds.maxLon,
        maxLat: bounds.maxLat,
      },
    };

    const { VisibleMapChartsDialogComponent } = await import(
      './components/map/components/visible-map-charts-dialog/visible-map-charts-dialog.component'
    );

    this.dialog.open(VisibleMapChartsDialogComponent, {
      data: {
        filter,
        zoom: bounds.zoom,
      },
      width: 'min(96vw, 1180px)',
      maxWidth: '96vw',
      maxHeight: '94vh',
      panelClass: 'visible-map-charts-dialog',
    });
  }

  onSubmitEvent(dataForm: DataFormValues) {
    this.showIndeterminateProgressBar.set(true);
    this.dateFilters = {
      before: this.dateService.formatYYYYMMDD(dataForm.beforeDate),
      after: this.dateService.formatYYYYMMDD(dataForm.afterDate),
    };
    this.dateFiltersSubject.next(this.dateFilters);
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();

    const street = dataForm.street.trim();
    const city = dataForm.city.trim();

    if (!street && !city) {
      this.showIndeterminateProgressBar.set(false);
      return;
    }
    this.queriesService
      .getAddressData(street, city, dataForm.state)
      .pipe(
        tap((addressResult) => {
          this.showIndeterminateProgressBar.set(false);

          if (!addressResult || addressResult.length === 0) {
            return;
          }
          this.addressCenter = {
            lon: addressResult[0].lon,
            lat: addressResult[0].lat,
          };
          this.syncMapInputs();
          this.changeDetectorRef.markForCheck();
        })
      )
      .subscribe();
  }

  private syncMapInputs(): void {
    const mapComponentRef = this.mapComponentRef;

    if (!mapComponentRef) return;

    mapComponentRef.setInput('addressCenter', this.addressCenter);
    mapComponentRef.setInput('dateFilters', this.dateFilters);
    mapComponentRef.setInput('hourFilter', this.hourFilter);
    mapComponentRef.setInput('periodFilter', this.periodFilter);
    mapComponentRef.setInput('progressBarPercentage', this.progressBarPercentage);
    mapComponentRef.setInput(
      'showIndeterminateProgressBar',
      this.showIndeterminateProgressBar
    );
    mapComponentRef.setInput('rubricasFormValues', this.categoriesFormValues);
  }

  private selectedCategories(): string[] {
    return Object.entries(this.categoriesFormValues ?? {})
      .filter(([, selected]) => selected)
      .map(([category]) => category);
  }
}
