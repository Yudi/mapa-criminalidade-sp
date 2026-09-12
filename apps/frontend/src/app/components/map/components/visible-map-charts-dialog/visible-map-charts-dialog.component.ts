import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  isRequestTimeoutError,
  REQUEST_TIMEOUT_MESSAGE,
} from '../../../../shared/request-timeout.service';
import { combineLatest, map, of, Subscription } from 'rxjs';
import {
  detailFilterEntries,
  DetailFilterKey,
} from '../../../../shared/map-detail-filters';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  MapFeatureCharts,
  MapFeatureFilterInput,
} from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../../../shared/occurrences.service';
import { WeekdayHourHeatmapComponent } from './weekday-hour-heatmap.component';
import {
  ChartCardComponent,
  ChartFilterKey,
  ChartFilterValue,
  VisibleMapChartConfig,
} from './chart-card.component';

export interface VisibleMapChartsDialogData {
  filter: MapFeatureFilterInput;
  zoom: number;
}

@Component({
  selector: 'app-visible-map-charts-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ChartCardComponent,
    WeekdayHourHeatmapComponent,
  ],
  templateUrl: './visible-map-charts-dialog.component.html',
  styleUrl: './visible-map-charts-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisibleMapChartsDialogComponent implements OnInit, OnDestroy {
  private readonly occurrencesService = inject(OccurrencesService);
  private readonly dialogRef = inject(
    MatDialogRef<VisibleMapChartsDialogComponent>
  );
  private readonly destroyRef = inject(DestroyRef);
  readonly data = inject<VisibleMapChartsDialogData>(MAT_DIALOG_DATA);

  readonly filter = signal<MapFeatureFilterInput>({ ...this.data.filter });
  readonly detailEntries = computed(() => detailFilterEntries(this.filter()));
  readonly categoriesChanged = computed(
    () =>
      !this.sameValues(this.filter().categories, this.data.filter.categories)
  );
  readonly changed = computed(
    () => JSON.stringify(this.filter()) !== JSON.stringify(this.data.filter)
  );
  private chartsRequest?: Subscription;
  private readonly facetCharts = signal<
    Partial<Record<ChartFilterKey, MapFeatureCharts>>
  >({});

  selectBucket(selection: {
    key: ChartFilterKey;
    value: ChartFilterValue;
  }): void {
    const { key, value } = selection;
    const currentValues = this.filterValues(key);
    const startsCategorySelection =
      key === 'categories' && !this.categoriesChanged();
    const selected = currentValues.includes(value);
    let nextValues = startsCategorySelection
      ? [value]
      : selected
      ? currentValues.filter((currentValue) => currentValue !== value)
      : [...currentValues, value];

    if (key === 'categories' && nextValues.length === 0) {
      nextValues = this.data.filter.categories ?? [];
    }

    this.filter.update(
      (filter) =>
        ({
          ...filter,
          [key]: nextValues.length ? nextValues : undefined,
        } as MapFeatureFilterInput)
    );
    this.loadCharts();
  }

  clearDetail(key: DetailFilterKey, value: ChartFilterValue): void {
    if (!this.filterValues(key).includes(value)) return;
    this.selectBucket({ key, value });
  }

  reset(): void {
    this.filter.set({
      ...this.filter(),
      vehicleBrands: undefined,
      objectTypes: undefined,
      phoneBrandModels: undefined,
      locationTypes: undefined,
      weekdays: undefined,
    });
    this.loadCharts();
  }

  resetCategories(): void {
    this.filter.update((filter) => ({
      ...filter,
      categories: this.data.filter.categories,
    }));
    this.loadCharts();
  }

  apply(): void {
    this.dialogRef.close(this.filter());
  }

  ngOnDestroy(): void {
    this.chartsRequest?.unsubscribe();
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly charts = signal<MapFeatureCharts | null>(null);

  readonly titleStats = computed(() => {
    const charts = this.charts();
    if (!charts) return [];

    return [
      {
        label: this.data.filter.area
          ? 'Ocorrências na área'
          : 'Ocorrências no mapa',
        value: this.formatNumber(charts.totalFeatures),
        icon: 'location_on',
      },
      {
        label: 'Registros relacionados',
        value: this.formatNumber(charts.totalRecords),
        icon: 'dataset',
      },
    ];
  });

  readonly chartCards = computed<VisibleMapChartConfig[]>(() => {
    const charts = this.charts();
    if (!charts) return [];
    const facets = this.facetCharts();

    const cards: VisibleMapChartConfig[] = [
      {
        title: 'Distribuição por rubrica',
        subtitle: 'Categorias das ocorrências.',
        icon: 'donut_large',
        displayType: 'pie',
        buckets: (facets.categories ?? charts).categoryDistribution.filter(
          (bucket) => this.data.filter.categories?.includes(bucket.label)
        ),
        filterKey: 'categories',
        selectedValues: this.categoriesChanged()
          ? this.filter().categories
          : undefined,
      },
      {
        title: 'Período da ocorrência',
        subtitle: '',
        icon: 'schedule',
        displayType: 'pie',
        buckets: charts.periodDistribution,
      },
      {
        title: 'Ocorrências por dia da semana',
        subtitle: '',
        icon: 'calendar_month',
        displayType: 'bar',
        buckets: (facets.weekdays ?? charts).weekdayDistribution,
        filterKey: 'weekdays',
        selectedValues: this.filter().weekdays,
      },
      {
        title: 'Tipos de registros',
        subtitle: '',
        icon: 'category',
        displayType: 'pie',
        buckets: charts.recordTypeDistribution,
      },
      {
        title: 'Objetos e celulares subtraídos',
        subtitle: '',
        icon: 'inventory_2',
        displayType: 'bar',
        buckets: (facets.objectTypes ?? charts).objectTypeDistribution,
        filterKey: 'objectTypes',
        selectedValues: this.filter().objectTypes,
        amountLabel: 'Quantidade',
      },
      {
        title: 'Marcas de veículos',
        subtitle: '',
        icon: 'directions_car',
        displayType: 'bar',
        buckets: (facets.vehicleBrands ?? charts).vehicleBrandDistribution,
        filterKey: 'vehicleBrands',
        selectedValues: this.filter().vehicleBrands,
      },
      {
        title: 'Celulares: marcas e modelos',
        subtitle: '',
        icon: 'smartphone',
        displayType: 'bar',
        buckets: (facets.phoneBrandModels ?? charts).phoneBrandDistribution,
        filterKey: 'phoneBrandModels',
        selectedValues: this.filter().phoneBrandModels,
        amountLabel: 'Quantidade',
      },
      {
        title: 'Tipo de local',
        subtitle: '',
        icon: 'place',
        displayType: 'bar',
        buckets: (facets.locationTypes ?? charts).locationTypeDistribution,
        filterKey: 'locationTypes',
        selectedValues: this.filter().locationTypes,
      },
      {
        title: 'Delegacia da circunscrição',
        subtitle: '',
        icon: 'local_police',
        displayType: 'bar',
        buckets: charts.policeCircumscriptionDistribution,
      },
      {
        title: 'Delegacia de registro',
        subtitle: '',
        icon: 'local_police',
        displayType: 'bar',
        buckets: charts.policeUnitDistribution,
      },
      {
        title: 'Armas apreendidas',
        subtitle: 'Tipos e calibres.',
        icon: 'gavel',
        displayType: 'bar',
        buckets: charts.weaponTypeDistribution,
      },
      {
        title: 'Entorpecentes',
        subtitle: 'Tipos e quantidade em gramas.',
        icon: 'medication',
        displayType: 'bar',
        buckets: charts.drugTypeDistribution,
        amountLabel: 'Gramas',
      },
    ];

    return cards.filter((card) => card.buckets.length > 0);
  });

  readonly hasActiveFilters = computed(() => {
    const filter = this.filter();
    return Boolean(
      filter.afterDate ||
        filter.beforeDate ||
        filter.categories?.length ||
        this.detailEntries().length ||
        filter.periods?.length ||
        filter.startHour !== undefined ||
        filter.endHour !== undefined
    );
  });

  ngOnInit(): void {
    this.loadCharts();
  }

  close(): void {
    this.dialogRef.close();
  }

  loadCharts(): void {
    this.chartsRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    const filter = this.filter();
    const facetRequests = this.activeFacetKeys(filter).map((key) =>
      this.occurrencesService
        .getChartsForBounds(this.withoutFacet(filter, key))
        .pipe(map((charts) => [key, charts] as const))
    );
    this.chartsRequest = combineLatest({
      charts: this.occurrencesService.getChartsForBounds(filter),
      facets: facetRequests.length ? combineLatest(facetRequests) : of([]),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ charts, facets }) => {
          this.charts.set(charts);
          this.facetCharts.set(Object.fromEntries(facets));
          this.loading.set(false);
        },
        error: (error) => {
          console.error('Error loading visible map charts:', error);
          this.error.set(
            isRequestTimeoutError(error)
              ? REQUEST_TIMEOUT_MESSAGE
              : 'Não foi possível carregar os gráficos do mapa.'
          );
          this.loading.set(false);
        },
      });
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: value % 1 === 0 ? 0 : 1,
    }).format(value);
  }

  private filterValues(key: ChartFilterKey): ChartFilterValue[] {
    return (this.filter()[key] ?? []) as ChartFilterValue[];
  }

  private activeFacetKeys(filter: MapFeatureFilterInput): ChartFilterKey[] {
    const detailKeys: DetailFilterKey[] = [
      'vehicleBrands',
      'objectTypes',
      'phoneBrandModels',
      'locationTypes',
      'weekdays',
    ];
    const keys: ChartFilterKey[] = detailKeys.filter(
      (key) => filter[key]?.length
    );
    if (!this.sameValues(filter.categories, this.data.filter.categories)) {
      keys.unshift('categories');
    }
    return keys;
  }

  private withoutFacet(
    filter: MapFeatureFilterInput,
    key: ChartFilterKey
  ): MapFeatureFilterInput {
    return {
      ...filter,
      [key]: key === 'categories' ? this.data.filter.categories : undefined,
    } as MapFeatureFilterInput;
  }

  private sameValues(
    left: readonly ChartFilterValue[] | undefined,
    right: readonly ChartFilterValue[] | undefined
  ): boolean {
    const leftValues = [...(left ?? [])].map(String).sort();
    const rightValues = [...(right ?? [])].map(String).sort();
    return (
      leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index])
    );
  }
}
