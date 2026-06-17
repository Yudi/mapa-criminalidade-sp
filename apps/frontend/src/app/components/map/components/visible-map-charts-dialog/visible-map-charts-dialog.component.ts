import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  isRequestTimeoutError,
  REQUEST_TIMEOUT_MESSAGE,
} from '../../../../shared/request-timeout.service';
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
import {
  ChartCardComponent,
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
  ],
  templateUrl: './visible-map-charts-dialog.component.html',
  styleUrl: './visible-map-charts-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisibleMapChartsDialogComponent implements OnInit {
  private readonly occurrencesService = inject(OccurrencesService);
  private readonly dialogRef = inject(
    MatDialogRef<VisibleMapChartsDialogComponent>
  );
  private readonly destroyRef = inject(DestroyRef);
  readonly data = inject<VisibleMapChartsDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly charts = signal<MapFeatureCharts | null>(null);

  readonly titleStats = computed(() => {
    const charts = this.charts();
    if (!charts) return [];

    return [
      {
        label: 'Ocorrências no mapa',
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

    const cards: VisibleMapChartConfig[] = [
      {
        title: 'Distribuição por rubrica',
        subtitle: 'Categorias das ocorrências.',
        icon: 'donut_large',
        displayType: 'pie',
        buckets: charts.categoryDistribution,
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
        subtitle: 'Distribuição temporal.',
        icon: 'calendar_month',
        displayType: 'bar',
        buckets: charts.weekdayDistribution,
      },
      {
        title: 'Tipos de registros',
        subtitle: 'Composição dos dados relacionados aos BOs.',
        icon: 'category',
        displayType: 'pie',
        buckets: charts.recordTypeDistribution,
      },
      {
        title: 'Objetos e celulares subtraídos',
        subtitle: 'Tipos de objeto com quantidade agregada quando disponível.',
        icon: 'inventory_2',
        displayType: 'bar',
        buckets: charts.objectTypeDistribution,
        amountLabel: 'Quantidade',
      },
      {
        title: 'Veículos: marcas e modelos',
        subtitle: 'Marca, tipo e ano-modelo quando disponível.',
        icon: 'directions_car',
        displayType: 'bar',
        buckets: charts.vehicleBrandDistribution,
      },
      {
        title: 'Celulares: marcas e modelos',
        subtitle: 'Marca e subtipo/modelo quando disponível.',
        icon: 'smartphone',
        displayType: 'bar',
        buckets: charts.phoneBrandDistribution,
        amountLabel: 'Quantidade',
      },
      {
        title: 'Tipo de local',
        subtitle: '',
        icon: 'place',
        displayType: 'bar',
        buckets: charts.locationTypeDistribution,
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
    const filter = this.data.filter;
    return Boolean(
      filter.afterDate ||
        filter.beforeDate ||
        filter.categories?.length ||
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

  private loadCharts(): void {
    this.occurrencesService
      .getChartsForBounds(this.data.filter)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (charts) => {
          this.charts.set(charts);
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
}
