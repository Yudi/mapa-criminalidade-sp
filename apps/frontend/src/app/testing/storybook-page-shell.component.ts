import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import {
  AnalysisArea,
  DataFormValues,
  MapDisplayMode,
} from '@mapa-criminalidade/shared-types';
import { CardComponent } from '../components/card/card.component';
import { ToolbarComponent } from '../components/toolbar/toolbar.component';
import { VisibleMapChartsDialogComponent } from '../components/map/components/visible-map-charts-dialog/visible-map-charts-dialog.component';
import { OccurrencesService } from '../shared/occurrences.service';
import {
  MapAreaState,
  MapDataState,
  MapStoryHarnessComponent,
} from './map-story-harness.component';
import {
  storyCategories,
  storyCharts,
  storyDateRange,
  storyPeriods,
} from './storybook.fixtures';

type HourFilter = { enabled: boolean; startHour: number; endHour: number };
type DetailEntry = {
  key: 'vehicleBrands' | 'objectTypes' | 'locationTypes';
  label: string;
  value: string;
};

@Component({
  selector: 'app-storybook-page-shell',
  imports: [CardComponent, MapStoryHarnessComponent, ToolbarComponent],
  template: `
    <header>
      <app-toolbar
        [showIndeterminateProgressBar]="showIndeterminateProgressBar"
        [progressBarPercentage]="progressBarPercentage"
      />
    </header>

    <main class="page-layout">
      <section class="map-section" aria-label="Mapa de ocorrências fictícias">
        <app-map-story-harness
          [embedded]="true"
          [mode]="mode()"
          [dataState]="dataState()"
          [areaState]="areaState()"
          [categories]="activeCategories()"
          [afterDate]="afterDate()"
          [beforeDate]="beforeDate()"
          [period]="period()"
          [hourFilterEnabled]="hourFilter().enabled"
          [startHour]="hourFilter().startHour"
          [endHour]="hourFilter().endHour"
          [longitude]="longitude()"
          [latitude]="latitude()"
          [radius]="radius()"
          [vehicleBrands]="detailValues('vehicleBrands')"
          [objectTypes]="detailValues('objectTypes')"
          [locationTypes]="detailValues('locationTypes')"
          (areaChange)="onAreaChange($event)"
        />
      </section>

      <section class="card-section" aria-label="Filtros de pesquisa">
        <p class="fixture-note">
          Esta composição usa dados fictícios e não faz requisições à API.
        </p>
        <app-card
          [rubricas]="categories$"
          [periods]="periods$"
          [dateRange]="dateRange"
          [selectedRubricas]="selectedCategories()"
          [detailEntries]="activeDetailEntries()"
          [statsUnavailable]="statsUnavailable()"
          [analysisAreaSelected]="analysisAreaSelected()"
          [canOpenVisibleCharts]="true"
          [viewportStatsLoading]="viewportStatsLoading()"
          (submitEvent)="onSubmit($event)"
          (rubricasFormEvent)="onCategoriesChange($event)"
          (periodFilterEvent)="onPeriodChange($event)"
          (hourFilterEvent)="onHourChange($event)"
          (visibleChartsEvent)="onChartsRequested()"
          (removeDetailEvent)="removeDetail($event)"
        />
      </section>
    </main>
  `,
  styles: `
    :host {
      background: var(--mat-sys-surface);
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
    }

    header {
      flex: 0 0 auto;
      position: relative;
      z-index: 2;
    }

    .page-layout {
      display: grid;
      flex: 1 1 auto;
      grid-template-areas:
        'map'
        'filters';
      min-height: 0;
    }

    .map-section {
      grid-area: map;
      min-height: 75dvh;
      min-width: 0;
      position: relative;
    }

    .card-section {
      grid-area: filters;
      min-width: 0;
      padding-block-end: 1rem;
    }

    .fixture-note {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font: var(--mat-sys-label-medium);
      margin: 0;
      padding: 0.625rem 1rem;
    }

    @media (min-width: 960px) {
      :host {
        height: 100dvh;
        overflow: hidden;
      }

      .page-layout {
        grid-template-areas: 'filters map';
        grid-template-columns: clamp(22rem, 27vw, 28rem) minmax(0, 1fr);
        overflow: hidden;
      }

      .map-section {
        min-height: 0;
      }

      .card-section {
        background: var(--mat-sys-surface-container-low);
        border-inline-end: 1px solid var(--mat-sys-outline-variant);
        min-height: 0;
        overflow-y: auto;
        padding-block-end: 0;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorybookPageShellComponent {
  private readonly dialog = inject(MatDialog);
  private readonly occurrencesService = inject(OccurrencesService);
  readonly mode = input<MapDisplayMode>('auto');
  readonly dataState = input<MapDataState>('loaded');
  readonly areaState = input<MapAreaState>('none');
  readonly initialCategories = input<string[]>([
    'Furto',
    'Roubo',
    'Estelionato',
    'Veículos recuperados',
  ]);
  readonly initialDetailEntries = input<DetailEntry[]>([]);
  readonly statsUnavailable = input(false);
  readonly viewportStatsLoading = input(false);
  readonly radius = input(750);

  readonly categories$ = of(storyCategories);
  readonly periods$ = of(storyPeriods);
  readonly dateRange = storyDateRange;
  readonly showIndeterminateProgressBar = signal(false);
  readonly progressBarPercentage = signal(-1);
  readonly selectedCategories = signal<Record<string, boolean>>({});
  readonly activeDetailEntries = signal<DetailEntry[]>([]);
  readonly period = signal<string | null>(null);
  readonly hourFilter = signal<HourFilter>({
    enabled: false,
    startHour: 0,
    endHour: 23,
  });
  readonly afterDate = signal<string | null>(storyDateRange.defaultAfter);
  readonly beforeDate = signal<string | null>(storyDateRange.latest);
  readonly longitude = signal(-46.63331);
  readonly latitude = signal(-23.55052);
  readonly userSelectedArea = signal<AnalysisArea | null>(null);
  readonly activeCategories = computed(() =>
    Object.entries(this.selectedCategories())
      .filter(([, selected]) => selected)
      .map(([name]) => name)
  );
  readonly analysisAreaSelected = computed(
    () => this.areaState() === 'radius' || this.userSelectedArea() !== null
  );

  constructor() {
    this.occurrencesService.getChartsForBounds = () => of(storyCharts);
  }

  private readonly synchronizeInitialCategories = effect(() => {
    const initial = this.initialCategories();
    untracked(() => {
      this.selectedCategories.set(
        Object.fromEntries(
          storyCategories.map(({ name }) => [name, initial.includes(name)])
        )
      );
    });
  });

  private readonly synchronizeInitialDetails = effect(() => {
    const initial = this.initialDetailEntries();
    untracked(() => this.activeDetailEntries.set([...initial]));
  });

  onCategoriesChange(categories: Record<string, boolean>): void {
    this.selectedCategories.set({ ...categories });
  }

  onPeriodChange(period: string | null): void {
    this.period.set(period);
  }

  onHourChange(hourFilter: HourFilter): void {
    this.hourFilter.set(hourFilter);
  }

  onSubmit(form: DataFormValues): void {
    this.afterDate.set(form.afterDate);
    this.beforeDate.set(form.beforeDate);

    if (form.street.trim() || form.city.trim()) {
      this.longitude.set(-46.63611);
      this.latitude.set(-23.54871);
      return;
    }
  }

  onAreaChange(area: AnalysisArea | null): void {
    this.userSelectedArea.set(area);
  }

  onChartsRequested(): void {
    const categories = this.activeCategories();
    const dialogRef = this.dialog.open(VisibleMapChartsDialogComponent, {
      data: {
        filter: {
          categories,
          afterDate: this.afterDate() ?? undefined,
          beforeDate: this.beforeDate() ?? undefined,
          periods: this.period() ? [this.period() as string] : undefined,
          startHour: this.hourFilter().enabled
            ? this.hourFilter().startHour
            : undefined,
          endHour: this.hourFilter().enabled
            ? this.hourFilter().endHour
            : undefined,
          vehicleBrands: this.detailValues('vehicleBrands'),
          objectTypes: this.detailValues('objectTypes'),
          locationTypes: this.detailValues('locationTypes'),
          area: this.userSelectedArea() ?? undefined,
        },
        zoom: 16,
      },
      width: 'min(96vw, 1180px)',
      maxWidth: '96vw',
      maxHeight: '94vh',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) return;
      this.selectedCategories.set(
        Object.fromEntries(
          storyCategories.map(({ name }) => [
            name,
            result.categories?.includes(name) ?? false,
          ])
        )
      );
      this.activeDetailEntries.set([
        ...(result.vehicleBrands ?? []).map((value: string) => ({
          key: 'vehicleBrands' as const,
          label: 'Marca de veículo',
          value,
        })),
        ...(result.objectTypes ?? []).map((value: string) => ({
          key: 'objectTypes' as const,
          label: 'Tipo de objeto',
          value,
        })),
        ...(result.locationTypes ?? []).map((value: string) => ({
          key: 'locationTypes' as const,
          label: 'Tipo de local',
          value,
        })),
      ]);
    });
  }

  removeDetail(key: DetailEntry['key']): void {
    this.activeDetailEntries.update((entries) =>
      entries.filter((entry) => entry.key !== key)
    );
  }

  detailValues(key: DetailEntry['key']): string[] {
    return this.activeDetailEntries()
      .filter((entry) => entry.key === key)
      .map((entry) => entry.value);
  }
}
