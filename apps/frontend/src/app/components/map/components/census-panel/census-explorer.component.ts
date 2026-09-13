import { CensusAreaDetail, CensusRelease } from '../../../../shared/graphql-projections';
import {
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  viewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, Subscription } from 'rxjs';
import OlMap from 'ol/Map';
import VectorTileLayer from 'ol/layer/VectorTile';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { transformExtent } from 'ol/proj';
import { unByKey } from 'ol/Observable';
import {
  CensusAreaSummary,
  CensusCrimeStats,
  CensusLevel,
  MapFeatureFilterInput,
  occurrencesPer100k,
} from '@mapa-criminalidade/shared-types';
import { CensusService } from '../../../../shared/census.service';
import { MAP_INTERACTIVE_LAYER_PROPERTY } from '../../utils/map-layer.constants';
import { CensusPanelComponent } from './census-panel.component';

type Reference = Pick<CensusAreaSummary, 'releaseId' | 'level' | 'code'>;

@Component({
  selector: 'app-census-explorer',
  imports: [
    MatIconModule,
    MatTooltipModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatDialogModule,
    CensusPanelComponent,
  ],
  templateUrl: './census-explorer.component.html',
  styleUrl: './census-explorer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CensusExplorerComponent {
  readonly map = input<OlMap | null>(null);
  readonly filter = input<MapFeatureFilterInput>({});
  readonly datasetRevision = input<string | null>(null);
  readonly drawing = input(false);
  readonly appliedCode = input<string | null>(null);
  readonly applyArea = output<CensusAreaDetail>();
  readonly release = signal<CensusRelease | null>(null);
  readonly level = signal<CensusLevel | 'off'>('off');
  readonly controlsOpened = output<void>();
  readonly opened = signal(false);
  readonly area = signal<CensusAreaDetail | null>(null);
  readonly crimes = signal<CensusCrimeStats | null>(null);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly releaseLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly detailError = signal<string | null>(null);
  readonly layerError = signal<string | null>(null);
  readonly results = signal<CensusAreaSummary[]>([]);
  readonly searchLoading = signal(false);
  readonly searched = signal(false);
  readonly searchError = signal<string | null>(null);
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly datesAvailable = computed(() =>
    Boolean(this.filter().afterDate && this.filter().beforeDate)
  );
  private readonly toggleButton = viewChild<
    unknown,
    ElementRef<HTMLButtonElement>
  >('toggleButton', { read: ElementRef });
  private readonly dialogTemplate =
    viewChild.required<TemplateRef<unknown>>('censusDialog');
  private readonly dialog = inject(MatDialog);
  private dialogRef?: MatDialogRef<unknown>;
  private currentLayer: VectorTileLayer | null = null;
  private readonly census = inject(CensusService);
  private readonly destroyRef = inject(DestroyRef);
  private detailSubscription?: Subscription;
  private searchSubscription?: Subscription;
  private statsSubscription?: Subscription;
  private releaseSubscription?: Subscription;
  private selectedReference: Reference | null = null;
  private readonly statsRetry = signal(0);
  private readonly layerRetry = signal(0);

  constructor() {
    effect(() => {
      this.area();
      this.appliedCode();
      this.currentLayer?.changed();
    });
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.search());
    effect((cleanup) => {
      const map = this.map(),
        release = this.release(),
        level = this.level();
      this.layerRetry();
      if (!map || !release || level === 'off') return;
      const labels = new Style({
        text: new Text({
          font: '600 12px sans-serif',
          fill: new Fill({ color: '#172b3a' }),
          stroke: new Stroke({ color: '#ffffff', width: 4 }),
          overflow: false,
        }),
      });
      const polygon = new Style({
        stroke: new Stroke({ color: '#285b80', width: 1.5 }),
        fill: new Fill({ color: 'rgba(40,91,128,0.035)' }),
      });
      const selectedPolygon = new Style({
        stroke: new Stroke({ color: '#163a57', width: 3 }),
        fill: new Fill({ color: 'rgba(40,91,128,0.14)' }),
      });
      const source = this.census.tiles(release.id, level);
      const layer = new VectorTileLayer({
        source,
        declutter: true,
        zIndex: 1,
        minZoom: level === 'municipality' ? 6 - 1e-6 : 11 - 1e-6,
        style: (feature) => {
          if (feature.get('layer') === 'labels') {
            labels.getText()?.setText(String(feature.get('name') ?? ''));
            return labels;
          }
          const key = `${release.id}:${level}:${String(feature.get('code'))}`;
          return this.appliedCode() === key ||
            this.area()?.code === feature.get('code')
            ? selectedPolygon
            : polygon;
        },
      });
      this.layerError.set(null);
      const errorKey = source.on('tileloaderror', () =>
        this.layerError.set('Falha ao carregar limites.')
      );
      this.currentLayer = layer;
      map.addLayer(layer);
      const clickKey = map.on('singleclick', (event) => {
        if (this.drawing()) return;
        // Crime markers retain priority; an empty part of the polygon opens its profile.
        if (
          map.hasFeatureAtPixel(event.pixel, {
            layerFilter: (candidate) =>
              candidate.get(MAP_INTERACTIVE_LAYER_PROPERTY) === true,
          })
        )
          return;
        const feature = map.getFeaturesAtPixel(event.pixel, {
          layerFilter: (candidate) => candidate === layer,
        })[0];
        if (feature)
          this.select({
            releaseId: release.id,
            level,
            code: String(feature.get('code')),
          });
      });
      cleanup(() => {
        this.currentLayer = null;
        unByKey([clickKey, errorKey]);
        map.removeLayer(layer);
        layer.dispose();
        source.dispose();
      });
    });
    effect(() => {
      const area = this.area();
      const filter = this.filter();
      this.datasetRevision();
      this.statsRetry();
      this.statsSubscription?.unsubscribe();
      this.crimes.set(null);
      this.error.set(null);
      this.loading.set(false);
      if (!area || !filter.afterDate || !filter.beforeDate) return;
      if (filter.categories?.length === 0) {
        this.crimes.set({
          occurrences: 0,
          per100k: occurrencesPer100k(0, area.population),
          after: filter.afterDate,
          before: filter.beforeDate,
        });
        return;
      }
      this.loading.set(true);
      const ref = {
        releaseId: area.releaseId,
        level: area.level,
        code: area.code,
      };
      this.statsSubscription = this.census.crimes(ref, filter).subscribe({
        next: (value) => {
          this.crimes.set(value);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Falha ao consultar ocorrências.');
          this.loading.set(false);
        },
      });
    });
    this.destroyRef.onDestroy(() => {
      this.dialogRef?.close();
      this.detailSubscription?.unsubscribe();
      this.searchSubscription?.unsubscribe();
      this.statsSubscription?.unsubscribe();
      this.releaseSubscription?.unsubscribe();
    });
  }

  toggle(): void {
    this.opened.update((value) => !value);
    if (this.opened()) this.controlsOpened.emit();
    if (this.opened() && !this.release() && !this.releaseLoading())
      this.loadRelease();
  }
  loadRelease(): void {
    this.releaseLoading.set(true);
    this.layerError.set(null);
    this.releaseSubscription?.unsubscribe();
    this.releaseSubscription = this.census.release().subscribe({
      next: (release) => {
        this.release.set(release);
        this.releaseLoading.set(false);
      },
      error: () => {
        this.layerError.set('Censo indisponível.');
        this.releaseLoading.set(false);
      },
    });
  }
  setLevel(level: CensusLevel | 'off'): void {
    this.level.set(level);
    this.searchSubscription?.unsubscribe();
    this.results.set([]);
    this.searched.set(false);
    this.searchLoading.set(false);
    if (level !== 'off') this.search();
  }
  search(): void {
    this.searchSubscription?.unsubscribe();
    const release = this.release(),
      level = this.level(),
      query = this.searchControl.value.trim();
    this.results.set([]);
    this.searchError.set(null);
    this.searched.set(false);
    this.searchLoading.set(false);
    if (!release || level === 'off' || query.length < 2) return;
    this.searchLoading.set(true);
    this.searchSubscription = this.census
      .search(release.id, level, query)
      .subscribe({
        next: (results) => {
          this.results.set(results);
          this.searchLoading.set(false);
          this.searched.set(true);
        },
        error: () => {
          this.searchError.set('Falha na busca.');
          this.searchLoading.set(false);
        },
      });
  }
  select(reference: Reference): void {
    this.selectedReference = reference;
    this.detailSubscription?.unsubscribe();
    this.area.set(null);
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.opened.set(false);
    this.openDialog();
    this.detailSubscription = this.census.detail(reference).subscribe({
      next: (area) => {
        this.area.set(area);
        this.detailLoading.set(false);
        this.map()
          ?.getView()
          .fit(transformExtent(area.bounds, 'EPSG:4326', 'EPSG:3857'), {
            padding: [60, 40, 60, 40],
            maxZoom: 16,
          });
      },
      error: () => {
        this.detailLoading.set(false);
        this.detailError.set('Falha ao carregar a área.');
      },
    });
  }
  private openDialog(): void {
    if (this.dialogRef) return;
    const ref = this.dialog.open(this.dialogTemplate(), {
      width: '640px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100dvh - 32px)',
      autoFocus: 'first-heading',
      restoreFocus: false,
      ariaLabel: 'Dados da área',
    });
    this.dialogRef = ref;
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.dialogRef !== ref) return;
        this.dialogRef = undefined;
        this.clearSelection();
        this.toggleButton()?.nativeElement.focus();
      });
  }
  applySelectedArea(): void {
    const area = this.area();
    if (area) this.applyArea.emit(area);
    this.dismiss();
  }
  dismiss(): void {
    if (this.dialogRef) this.dialogRef.close();
    else this.clearSelection();
  }
  private clearSelection(): void {
    this.detailSubscription?.unsubscribe();
    this.statsSubscription?.unsubscribe();
    this.area.set(null);
    this.crimes.set(null);
    this.detailLoading.set(false);
    this.detailError.set(null);
  }
  retryDetail(): void {
    if (this.selectedReference) this.select(this.selectedReference);
  }
  retryStats(): void {
    this.statsRetry.update((value) => value + 1);
  }
  retryLayer(): void {
    if (this.release()) this.layerRetry.update((value) => value + 1);
    else this.loadRelease();
  }
}
