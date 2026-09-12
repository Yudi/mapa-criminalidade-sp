import { TemporalAnalysisComponent } from './components/temporal-analysis/temporal-analysis.component';
import {
  TemporalRange,
  TemporalMapState,
  displayDate,
} from './components/temporal-analysis/temporal-analysis.utils';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentRef,
  ElementRef,
  computed,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  ViewContainerRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  DetailFilterEntry,
  detailFilterEntries,
} from './shared/map-detail-filters';
import { CardComponent } from './components/card/card.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';

import { isPlatformBrowser } from '@angular/common';
import { MatIconRegistry } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import DataFormValues from './shared/dataForm.interface';
import {
  AddressSearchInputError,
  QueriesService,
} from './shared/queries.service';
import { OccurrencesService } from './shared/occurrences.service';
import { DateService } from './shared/date.service';
import { ProgressBarService } from './shared/progressbar.service';
import { VectorTileService } from './shared/vector-tile.service';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  skip,
  takeUntil,
  switchMap,
  take,
  tap,
} from 'rxjs';
import {
  AnalysisArea,
  CategoryInfo,
  DateRange,
  MapFeatureFilterInput,
  MapFeatureDetailFilters,
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
  temporalState: {
    subscribe: (
      callback: (state: TemporalMapState) => void
    ) => SubscriptionLike;
  };
  areaChange: {
    subscribe: (
      callback: (area: AnalysisArea | null) => void
    ) => SubscriptionLike;
  };
  boundsChange: {
    subscribe: (callback: (bounds: MapBounds) => void) => SubscriptionLike;
  };
};
@Component({
  selector: 'app-root',
  imports: [
    CardComponent,
    ToolbarComponent,
    MatButtonModule,
    TemporalAnalysisComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements AfterViewInit, OnDestroy {
  title = 'frontend';
  readonly detailFilters = signal<MapFeatureDetailFilters>({});
  readonly detailEntries = computed(() =>
    detailFilterEntries(this.detailFilters())
  );

  removeDetailFilter(entry: DetailFilterEntry): void {
    const current = this.detailFilters();
    const remaining = (current[entry.key] ?? []).filter(
      (value) => value !== entry.value
    );
    this.updateDetailFilters({
      ...current,
      [entry.key]: remaining.length ? remaining : undefined,
    });
  }

  private updateDetailFilters(filters: MapFeatureDetailFilters): void {
    this.closeTemporal();
    this.detailFilters.set(filters);
    this.retryStats();
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }

  readonly temporalFilter = signal<MapFeatureFilterInput | null>(null);
  readonly temporalFrame = signal<TemporalRange | null>(null);
  readonly temporalMapState = signal<TemporalMapState | null>(null);
  readonly temporalPanel = viewChild<{
    pause(): void;
    play(): void;
    restore(): void;
    playing(): boolean;
  }>('temporalPanel');
  readonly displayDate = displayDate;
  private temporalSubscription: SubscriptionLike | null = null;
  @ViewChild('mapSection') private mapSection?: ElementRef<HTMLElement>;

  focusTemporalMap(): void {
    if (this.isBrowserOnly && window.matchMedia('(max-width: 959px)').matches) {
      this.mapSection?.nativeElement.scrollIntoView({
        block: 'start',
        behavior: 'instant',
      });
    }
  }

  openTemporal(): void {
    const bounds = this.currentBounds;
    if (!bounds || !this.canOpenVisibleCharts || !this.dateRange) return;
    const area = this.analysisArea();
    this.temporalFilter.set({
      ...this.detailFilters(),
      afterDate: this.dateFilters.after ?? undefined,
      beforeDate: this.dateFilters.before ?? undefined,
      categories: this.selectedCategories(),
      periods: this.periodFilter ? [this.periodFilter] : undefined,
      startHour: this.hourFilter.enabled
        ? this.hourFilter.startHour
        : undefined,
      endHour: this.hourFilter.enabled ? this.hourFilter.endHour : undefined,
      ...(area
        ? { area }
        : {
            bounds: {
              minLon: bounds.minLon,
              minLat: bounds.minLat,
              maxLon: bounds.maxLon,
              maxLat: bounds.maxLat,
            },
          }),
    });
  }

  closeTemporal(): void {
    if (!this.temporalFilter() && !this.temporalFrame()) return;
    this.temporalPanel()?.pause();
    this.temporalFilter.set(null);
    this.onTemporalFrame(null);
  }

  onTemporalFrame(frame: TemporalRange | null): void {
    this.temporalFrame.set(frame);
    this.temporalMapState.set(null);
    this.syncMapInputs();
  }

  private platformId = inject(PLATFORM_ID);
  private queriesService = inject(QueriesService);
  private occurrencesService = inject(OccurrencesService);
  private iconRegistry = inject(MatIconRegistry);
  private dateService = inject(DateService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private progressBarService = inject(ProgressBarService);
  private vectorTileService = inject(VectorTileService);
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
  readonly statsError = signal(false);
  private readonly statsRefreshSubject = new BehaviorSubject(0);
  metadataLoadError = signal(false);
  metadataLoading = signal(false);
  datasetRevision: string | null = null;
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
  readonly analysisArea = signal<AnalysisArea | null>(null);
  private areaSubject = new BehaviorSubject<AnalysisArea | null>(null);
  private areaSubscription: SubscriptionLike | null = null;
  private boundsSubject = new BehaviorSubject<MapBounds | null>(null);
  // Do not emit until metadata provides the bounded default date range.
  private dateFiltersSubject = new ReplaySubject<DateFilters>(1);
  private periodFilterSubject = new BehaviorSubject<string | null>(
    this.periodFilter
  );
  private hourFilterSubject = new BehaviorSubject<HourFilter>(this.hourFilter);
  private datasetRevisionSubject = new BehaviorSubject<string | null>(null);
  currentBounds: MapBounds | null = null;
  isMapComponentLoaded = signal(false);
  mapLoadError = signal(false);
  private isDestroyed = false;
  private mapComponentRef: ComponentRef<DynamicMapComponent> | null = null;
  private mapBoundsSubscription: SubscriptionLike | null = null;
  private metadataLoaded = false;

  @ViewChild('mapOutlet', { read: ViewContainerRef })
  private mapOutlet?: ViewContainerRef;

  get isBrowserOnly(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  get canLoadStats(): boolean {
    return Boolean(
      this.currentBounds &&
        (this.analysisArea() || this.currentBounds.zoom >= MIN_CRIME_TILE_ZOOM)
    );
  }

  get canOpenVisibleCharts(): boolean {
    const selectedCategories = this.selectedCategories();

    return Boolean(this.canLoadStats && selectedCategories.length > 0);
  }

  constructor() {
    this.iconRegistry.setDefaultFontSetClass('material-symbols-outlined');

    if (this.isBrowserOnly) {
      this.loadInitialDateRange();
      this.loadMetadata();
    }
    const categoryPeriodStats = combineLatest([
      this.boundsSubject,
      this.dateFiltersSubject,
      this.periodFilterSubject,
      this.hourFilterSubject,
      this.datasetRevisionSubject,
      this.areaSubject,
      this.statsRefreshSubject,
    ]).pipe(
      debounceTime(300),
      distinctUntilChanged(
        (prev, curr) =>
          (curr[5] != null ||
            (prev[0]?.minLon === curr[0]?.minLon &&
              prev[0]?.minLat === curr[0]?.minLat &&
              prev[0]?.maxLon === curr[0]?.maxLon &&
              prev[0]?.maxLat === curr[0]?.maxLat &&
              prev[0]?.zoom === curr[0]?.zoom)) &&
          prev[5] === curr[5] &&
          prev[6] === curr[6] &&
          prev[1].before === curr[1].before &&
          prev[1].after === curr[1].after &&
          prev[2] === curr[2] &&
          prev[3].enabled === curr[3].enabled &&
          prev[3].startHour === curr[3].startHour &&
          prev[3].endHour === curr[3].endHour &&
          prev[4] === curr[4]
      ),
      switchMap(([bounds, dateFilters, periodFilter, hourFilter, , area]) => {
        if (!bounds || (!area && bounds.zoom < MIN_CRIME_TILE_ZOOM)) {
          this.statsError.set(false);
          this.viewportStatsLoading.set(false);
          return EMPTY;
        }
        this.statsError.set(false);
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
            hourFilter.enabled ? hourFilter.endHour : undefined,
            area ?? undefined,
            this.detailFilters()
          )
          .pipe(
            // Cancel the old scope immediately, before the next debounced query.
            takeUntil(this.areaSubject.pipe(skip(1))),
            tap(() => this.viewportStatsLoading.set(false)),
            catchError((error: unknown) => {
              this.viewportStatsLoading.set(false);
              this.statsError.set(true);
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

    this.categories = categoryPeriodStats.pipe(
      map((stats) => stats.categories)
    );
    this.periods = categoryPeriodStats.pipe(map((stats) => stats.periods));
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowserOnly || !this.mapOutlet) return;

    await this.loadMapComponent();
  }

  retryMapLoad(): void {
    if (this.isDestroyed || !this.isBrowserOnly || !this.mapOutlet) return;
    void this.loadMapComponent();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.temporalSubscription?.unsubscribe();
    this.mapBoundsSubscription?.unsubscribe();
    this.areaSubscription?.unsubscribe();
    this.mapComponentRef?.destroy();
    this.mapBoundsSubscription = null;
    this.mapComponentRef = null;
  }

  onRubricasFormChange(rubricasFormValues: { [key: string]: boolean }) {
    if (
      this.categoriesFormValues &&
      this.selectedCategoryKey(this.categoriesFormValues) ===
        this.selectedCategoryKey(rubricasFormValues)
    ) {
      return;
    }

    this.closeTemporal();
    this.categoriesFormValues = rubricasFormValues;
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }

  onPeriodFilterChange(period: string | null) {
    this.closeTemporal();
    this.periodFilter = period;
    this.periodFilterSubject.next(period);
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }

  onHourFilterChange(hourFilter: HourFilter) {
    this.closeTemporal();
    this.hourFilter = hourFilter;
    this.hourFilterSubject.next(hourFilter);
    this.syncMapInputs();
    this.changeDetectorRef.markForCheck();
  }

  retryMetadata(): void {
    if (this.isDestroyed || !this.isBrowserOnly) return;

    this.occurrencesService.clearCache();
    this.vectorTileService.clearMetadataCache();
    this.loadInitialDateRange();
    this.loadMetadata();
  }
  retryStats(): void {
    this.statsRefreshSubject.next(this.statsRefreshSubject.value + 1);
  }

  onAreaChange(area: AnalysisArea | null): void {
    this.closeTemporal();
    this.viewportStatsLoading.set(true);
    this.analysisArea.set(area);
    this.areaSubject.next(area);
  }

  onBoundsChange(bounds: MapBounds) {
    if (
      this.temporalFilter() &&
      !this.analysisArea() &&
      JSON.stringify(bounds) !== JSON.stringify(this.currentBounds)
    )
      this.closeTemporal();
    this.currentBounds = bounds;
    this.boundsSubject.next(bounds);
    if (this.metadataLoadError() && !this.metadataLoading()) {
      this.loadMetadata();
    }
    this.changeDetectorRef.markForCheck();
  }

  async onVisibleChartsClick(): Promise<void> {
    const bounds = this.currentBounds;
    if (!bounds || !this.canOpenVisibleCharts) return;

    const area = this.analysisArea();
    const filter: MapFeatureFilterInput = {
      ...this.detailFilters(),
      beforeDate: this.dateFilters.before ?? undefined,
      afterDate: this.dateFilters.after ?? undefined,
      categories: this.selectedCategories(),
      periods: this.periodFilter ? [this.periodFilter] : undefined,
      startHour: this.hourFilter.enabled
        ? this.hourFilter.startHour
        : undefined,
      endHour: this.hourFilter.enabled ? this.hourFilter.endHour : undefined,
      ...(area
        ? { area }
        : {
            bounds: {
              minLon: bounds.minLon,
              minLat: bounds.minLat,
              maxLon: bounds.maxLon,
              maxLat: bounds.maxLat,
            },
          }),
    };

    try {
      const { VisibleMapChartsDialogComponent } = await import(
        './components/map/components/visible-map-charts-dialog/visible-map-charts-dialog.component'
      );

      this.dialog
        .open(VisibleMapChartsDialogComponent, {
          data: {
            filter,
            zoom: bounds.zoom,
          },
          width: 'min(96vw, 1180px)',
          maxWidth: '96vw',
          maxHeight: '94vh',
          panelClass: 'visible-map-charts-dialog',
        })
        .afterClosed()
        .pipe(take(1))
        .subscribe((result: MapFeatureFilterInput | undefined) => {
          if (!result || this.isDestroyed) return;
          this.categoriesFormValues = Object.fromEntries(
            (result.categories ?? []).map((category) => [category, true])
          );
          this.updateDetailFilters({
            vehicleBrands: result.vehicleBrands,
            objectTypes: result.objectTypes,
            phoneBrandModels: result.phoneBrandModels,
            locationTypes: result.locationTypes,
            weekdays: result.weekdays,
          });
          this.snackBar.open('Filtros aplicados ao mapa.', 'Fechar', {
            duration: 3000,
          });
        });
    } catch (error) {
      console.error('Error loading visible map charts dialog:', error);
      this.snackBar.open(
        'Não foi possível abrir os gráficos do mapa. Tente novamente.',
        'Fechar',
        { duration: 5000 }
      );
    }
  }

  onSubmitEvent(dataForm: DataFormValues) {
    this.closeTemporal();
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
      .subscribe({
        error: (error: unknown) => {
          this.showIndeterminateProgressBar.set(false);
          console.error('Error searching address:', error);
          this.snackBar.open(
            error instanceof AddressSearchInputError
              ? error.message
              : 'Não foi possível buscar este endereço. Tente novamente.',
            'Fechar',
            { duration: 5000 }
          );
          this.changeDetectorRef.markForCheck();
        },
      });
  }

  private async loadMapComponent(): Promise<void> {
    if (this.isDestroyed || !this.mapOutlet || this.mapComponentRef) return;

    this.mapLoadError.set(false);
    try {
      const { MapComponent } = await import('./components/map/map.component');

      if (this.isDestroyed || !this.mapOutlet) return;

      this.mapComponentRef = this.mapOutlet.createComponent(MapComponent);
      this.mapBoundsSubscription =
        this.mapComponentRef.instance.boundsChange.subscribe((bounds) =>
          this.onBoundsChange(bounds)
        );
      this.areaSubscription =
        this.mapComponentRef.instance.areaChange.subscribe((area) =>
          this.onAreaChange(area)
        );
      this.temporalSubscription =
        this.mapComponentRef.instance.temporalState.subscribe((state) =>
          this.temporalMapState.set(state)
        );
      this.syncMapInputs();
      this.isMapComponentLoaded.set(true);
    } catch (error) {
      if (this.isDestroyed) return;
      this.isMapComponentLoaded.set(false);
      this.mapLoadError.set(true);
      console.error('Error loading map component:', error);
      this.snackBar.open(
        'Não foi possível carregar o mapa. Tente novamente.',
        'Fechar',
        { duration: 6000 }
      );
      this.changeDetectorRef.markForCheck();
    }
  }

  private syncMapInputs(): void {
    const mapComponentRef = this.mapComponentRef;

    if (!mapComponentRef) return;

    mapComponentRef.setInput('addressCenter', this.addressCenter);
    const frame = this.temporalFrame();
    mapComponentRef.setInput(
      'dateFilters',
      frame
        ? { after: frame.afterDate, before: frame.beforeDate }
        : this.dateFilters
    );
    mapComponentRef.setInput('datasetRevision', this.datasetRevision);
    mapComponentRef.setInput('hourFilter', this.hourFilter);
    mapComponentRef.setInput('periodFilter', this.periodFilter);
    mapComponentRef.setInput('detailFilters', this.detailFilters());
    mapComponentRef.setInput(
      'progressBarPercentage',
      this.progressBarPercentage
    );
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

  private selectedCategoryKey(values: { [key: string]: boolean }): string {
    return Object.entries(values)
      .filter(([, selected]) => selected)
      .map(([category]) => category)
      .sort()
      .join('\u001f');
  }

  private loadMetadata(): void {
    if (this.isDestroyed || !this.isBrowserOnly || this.metadataLoading())
      return;

    this.metadataLoading.set(true);
    this.occurrencesService
      .getTileMetadata()
      .pipe(
        take(1),
        finalize(() => {
          this.metadataLoading.set(false);
          this.changeDetectorRef.markForCheck();
        })
      )
      .subscribe({
        next: (metadata) => {
          this.metadataLoadError.set(false);
          const revisionChanged =
            this.metadataLoaded &&
            this.datasetRevision !== metadata.datasetRevision;

          if (revisionChanged) {
            this.closeTemporal();
            this.occurrencesService.clearCacheByPrefix('category-period-stats');
            this.occurrencesService.clearCacheByPrefix('charts-bounds');
          }

          this.metadataLoaded = true;
          this.datasetRevision = metadata.datasetRevision ?? null;
          this.datasetRevisionSubject.next(this.datasetRevision);
          this.applyDateRange(metadata.dateRange);

          this.syncMapInputs();

          this.changeDetectorRef.markForCheck();
        },
        error: (error: unknown) => {
          this.metadataLoadError.set(true);
          console.error('Error loading map metadata:', error);
        },
      });
  }

  private loadInitialDateRange(): void {
    this.occurrencesService
      .getDateRange()
      .pipe(take(1))
      .subscribe({
        next: (dateRange) => {
          this.applyDateRange(dateRange);
          this.syncMapInputs();
          this.changeDetectorRef.markForCheck();
        },
        error: (error: unknown) => {
          // Full metadata remains a fallback for the same date range.
          console.error('Error loading initial map date range:', error);
        },
      });
  }

  private applyDateRange(dateRange: DateRange): void {
    if (
      this.dateRange?.earliest !== dateRange.earliest ||
      this.dateRange?.latest !== dateRange.latest ||
      this.dateRange?.defaultAfter !== dateRange.defaultAfter
    ) {
      this.dateRange = dateRange;
    }

    if (this.dateFilters.before || this.dateFilters.after) {
      return;
    }

    const defaultAfterDate = this.dateService.defaultAfterDate(dateRange);
    this.dateFilters = {
      after: this.dateService.formatYYYYMMDD(defaultAfterDate) || null,
      before: dateRange.latest,
    };
    this.dateFiltersSubject.next(this.dateFilters);
  }
}
