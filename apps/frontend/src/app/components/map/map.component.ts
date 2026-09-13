import { CensusAreaDetail } from '../../shared/graphql-projections';
import { CensusExplorerComponent } from './components/census-panel/census-explorer.component';
import type {
  MapFeatureFilterInput,
} from '@mapa-criminalidade/shared-types';
import {
  MapDisplayMode,
  MapFeatureDetailFilters,
} from '@mapa-criminalidade/shared-types';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import {
  createDensityStyleFunction,
  DENSITY_BANDS,
} from './utils/map-density-style.utils';
import type { TemporalMapState } from '../temporal-analysis/temporal-analysis.utils';
import {
  AfterViewInit,
  computed,
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  WritableSignal,
  inject,
  input,
  output,
  signal,
  DOCUMENT,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import OlMap from 'ol/Map';
import { fromLonLat, toLonLat } from 'ol/proj';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorLayer from 'ol/layer/Vector';
import Heatmap from 'ol/layer/Heatmap';
import { buffer } from 'ol/extent';
import {
  createOccurrenceHeatmap,
  HEATMAP_BLUR,
  HEATMAP_RADIUS,
  synchronizeHeatmapPoints,
} from './utils/map-heatmap.utils';
import VectorTileSource from 'ol/source/VectorTile';
import VectorSource from 'ol/source/Vector';
import ClusterSource from 'ol/source/Cluster';
import MVTFormat from 'ol/format/MVT';
import Feature from 'ol/Feature';
import { Subject, take } from 'rxjs';
import { FeatureLike } from 'ol/Feature';
import { unByKey } from 'ol/Observable';
import { EventsKey } from 'ol/events';
import Point from 'ol/geom/Point';
import Draw from 'ol/interaction/Draw';
import GeoJSON from 'ol/format/GeoJSON';
import { circular } from 'ol/geom/Polygon';
import { Fill, Stroke, Style } from 'ol/style';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  AnalysisArea,
  ANALYSIS_AREA_LIMITS,
  isValidAnalysisArea,
} from '@mapa-criminalidade/shared-types';
import type { LoadFunction } from 'ol/Tile';

import { MapMarkersService } from '../../shared/map-markers.service';
import {
  VectorTileService,
  ExtendedTileFilterParams,
} from '../../shared/vector-tile.service';
import { VectorTileMapSetupService } from './services/vector-tile-map-setup.service';
import { MAP_INTERACTIVE_LAYER_PROPERTY } from './utils/map-layer.constants';
import { DateService } from '../../shared/date.service';
import {
  MAX_CRIME_TILE_ZOOM,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import {
  createClusterStyleFunction,
  createOccurrenceStyleFunction,
} from './utils/map-style.utils';
import {
  createClientClusterFeature,
  getClusterFeatureKey,
  getFeatureCoordinate,
  shouldIncludeClientClusterFeature,
} from './utils/map-cluster.utils';
import {
  createVectorTileLoadFunction,
  TileCompleteness,
  VectorTileLoadError,
} from './utils/map-tile-loader.utils';
const DEFAULT_ZOOM = 16;
const MAP_MAX_ZOOM = 19;
const LAYER_MAX_ZOOM = MAP_MAX_ZOOM + 1;
const CLIENT_CLUSTER_MIN_ZOOM = 16;
// OpenLayers treats minZoom as exclusive. The tile SQL switches from server
// clusters to raw points at z=16. The tiny adjustment keeps the layer eligible
// at the exact integer boundary without requesting tiles below z=10.
const OPENLAYERS_ZOOM_EPSILON = 1e-6;
export const TILE_LAYER_MIN_ZOOM =
  MIN_CRIME_TILE_ZOOM - OPENLAYERS_ZOOM_EPSILON;
// Client clustering can be visible during the half-zoom transition. Server
// cluster features are excluded from its source, so there is no double render.
export const CLIENT_CLUSTER_LAYER_MIN_ZOOM = CLIENT_CLUSTER_MIN_ZOOM - 1;
const CLUSTER_DISTANCE_PX = 44;
const CLUSTER_MIN_DISTANCE_PX = 28;
const TILE_LAYER_UPDATE_DEBOUNCE_MS = 200;
const TILE_SOURCE_CACHE_SIZE = 256;
export interface MapBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  zoom: number;
}

type HourFilter = { enabled: boolean; startHour: number; endHour: number };

@Component({
  selector: 'app-map',
  imports: [
    CensusExplorerComponent,
    MatButtonModule,
    MatIconModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly censusMap = signal<OlMap | null>(null);
  readonly censusAreaName = signal<string | null>(null);
  readonly censusAppliedCode = computed(() => {
    const ref = this.selectedArea()?.census;
    return ref ? `${ref.releaseId}:${ref.level}:${ref.code}` : null;
  });
  readonly censusFilter = computed<MapFeatureFilterInput>(() => {
    const filters = this.currentFilters();
    return {
      afterDate: filters.after,
      beforeDate: filters.before,
      categories: this.activeCategories(),
      periods: filters.periods,
      weekdays: filters.weekdays,
      startHour: filters.startHour,
      endHour: filters.endHour,
      vehicleBrands: filters.vehicleBrands,
      objectTypes: filters.objectTypes,
      phoneBrandModels: filters.phoneBrandModels,
      locationTypes: filters.locationTypes,
    };
  });
  selectCensusArea(area: CensusAreaDetail): void {
    this.cancelDrawing();
    this.areaSource.clear();
    this.areaError.set(null);
    const selection: AnalysisArea = {
      census: { releaseId: area.releaseId, level: area.level, code: area.code },
    };
    this.censusAreaName.set(area.name);
    this.selectedArea.set(selection);
    this.areaControlsOpen.set(false);
    this.areaChange.emit(selection);
  }
  readonly displayControlsOpen = signal(false);
  readonly displayMode = signal<MapDisplayMode>('auto');
  readonly densityBands = DENSITY_BANDS;

  setDisplayMode(mode: MapDisplayMode): void {
    if (mode === this.displayMode()) return;
    this.displayMode.set(mode);
    this.currentFilters.update((filters) => ({ ...filters, mode }));
    if (this.olMap) this.mapSetupService.disposeMapState(this.olMap);
    this.updateTileLayer();
  }
  readonly addressCenter = input.required<{
    lon: number | null;
    lat: number | null;
  }>();

  readonly dateFilters = input.required<{
    before: string | null;
    after: string | null;
  }>();
  readonly detailFilters = input<MapFeatureDetailFilters>({});
  readonly datasetRevision = input<string | null>(null);
  readonly periodFilter = input.required<string | null>();
  readonly hourFilter = input.required<HourFilter>();

  readonly rubricasFormValues = input.required<
    { [key: string]: boolean } | undefined
  >();
  readonly showIndeterminateProgressBar =
    input.required<WritableSignal<boolean>>();
  readonly progressBarPercentage = input.required<WritableSignal<number>>();
  readonly boundsChange = output<MapBounds>();
  readonly areaChange = output<AnalysisArea | null>();
  readonly temporalState = output<TemporalMapState>();
  private temporalRenderKey: EventsKey | null = null;
  private temporalDates: Pick<TemporalMapState, 'after' | 'before'> = {
    after: null,
    before: null,
  };
  readonly drawing = signal(false);
  readonly areaControlsOpen = signal(false);
  readonly selectedArea = signal<AnalysisArea | null>(null);
  readonly areaError = signal<string | null>(null);
  readonly radiusControl = new FormControl(500, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(1), Validators.max(10000)],
  });
  private readonly areaSource = new VectorSource();
  private areaLayer: VectorLayer | null = null;
  private drawInteraction: Draw | null = null;

  startDrawing(): void {
    if (!this.olMap) return;
    const map = this.olMap;
    this.cancelDrawing();
    this.areaError.set(null);
    this.drawing.set(true);
    this.drawInteraction = new Draw({
      type: 'Polygon',
      maxPoints: ANALYSIS_AREA_LIMITS.maxVertices,
      stopClick: true,
    });
    this.drawInteraction.on('drawend', (event) => {
      const geometry = event.feature.getGeometry();
      if (!geometry) return;
      const polygon = new GeoJSON().writeGeometry(geometry, {
        featureProjection: map.getView().getProjection(),
        dataProjection: 'EPSG:4326',
      });
      const area = { polygon };
      if (!isValidAnalysisArea(area)) {
        this.areaError.set(
          'Área inválida ou muito extensa. Use até 100 pontos, sem cruzar linhas, em um recorte de até 10.000 km² e 200 km de extensão.'
        );
      } else {
        this.areaSource.clear();
        this.areaSource.addFeature(event.feature);
        this.areaControlsOpen.set(false);
        this.selectedArea.set(area);
        this.areaChange.emit(area);
      }
      this.cancelDrawing();
    });
    this.olMap.addInteraction(this.drawInteraction);
  }

  finishDrawing(): void {
    this.drawInteraction?.finishDrawing();
  }

  undoVertex(): void {
    this.drawInteraction?.removeLastPoint();
  }

  cancelDrawing(): void {
    if (this.drawInteraction) {
      this.drawInteraction.abortDrawing();
      this.olMap?.removeInteraction(this.drawInteraction);
      this.drawInteraction.dispose();
      this.drawInteraction = null;
    }
    this.drawing.set(false);
  }

  selectRadius(): void {
    const { lon, lat } = this.addressCenter();
    if (!this.olMap || lon == null || lat == null || this.radiusControl.invalid)
      return;
    const area = {
      longitude: lon,
      latitude: lat,
      radius: this.radiusControl.value,
    };
    if (!isValidAnalysisArea(area)) return;
    this.cancelDrawing();
    this.areaError.set(null);
    const geometry = circular([lon, lat], area.radius, 128).transform(
      'EPSG:4326',
      this.olMap.getView().getProjection()
    );
    this.areaSource.clear();
    this.areaSource.addFeature(new Feature(geometry));
    this.areaControlsOpen.set(false);
    this.selectedArea.set(area);
    this.areaChange.emit(area);
    this.olMap
      .getView()
      .fit(geometry, { padding: [50, 50, 220, 50], maxZoom: 17 });
  }

  clearArea(): void {
    this.cancelDrawing();
    this.areaSource.clear();
    this.areaError.set(null);
    this.selectedArea.set(null);
    this.areaChange.emit(null);
  }

  private readonly markersService = inject(MapMarkersService);
  private readonly vectorTileService = inject(VectorTileService);
  private readonly mapSetupService = inject(VectorTileMapSetupService);
  private readonly dateService = inject(DateService);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly destroy$ = new Subject<void>();
  private tileRequestCancellation$ = new Subject<void>();
  olMap: OlMap | null = null;
  private tileLayer: VectorTileLayer | null = null;
  private tileSource: VectorTileSource | null = null;
  private heatmapLayer: Heatmap<Feature<Point>> | null = null;
  private heatmapRenderKey: EventsKey | null = null;

  private moveEndListenerKey: EventsKey | null = null;
  private tileLoadEndListenerKey: EventsKey | null = null;
  private isDestroyed = false;
  readonly activeCategories = signal<string[]>([]);
  private currentFilters = signal<ExtendedTileFilterParams>({});
  private clusterLayer: VectorLayer<
    ClusterSource<Feature<Point>>,
    FeatureLike
  > | null = null;
  private clusterFeatureSource: VectorSource<Feature<Point>> | null = null;
  private loadedClusterFeatureKeys = new Set<string>();
  private tileLayerVersion = 0;
  private tileTimeoutDialogOpen = false;
  private clusterRefreshAnimationFrame: number | null = null;
  private tileLayerUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  readonly tileError = signal<string | null>(null);
  readonly tileCompleteness = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    // Skip map updates during SSR
    if (!this.isBrowser) return;

    if (changes['addressCenter']) {
      const current = changes['addressCenter'].currentValue;
      if (current?.lon != null && current?.lat != null) {
        this.handleAddressCenterChange();
      }
    }

    if (changes['dateFilters']) {
      this.handleDateFiltersChange();
    }

    if (changes['datasetRevision']) {
      this.handleDatasetRevisionChange();
    }

    if (changes['detailFilters']) {
      const details = this.detailFilters();
      this.currentFilters.update((filters) => ({
        ...filters,
        vehicleBrands: details.vehicleBrands,
        objectTypes: details.objectTypes,
        phoneBrandModels: details.phoneBrandModels,
        locationTypes: details.locationTypes,
        weekdays: details.weekdays,
      }));
      this.scheduleTileLayerUpdate();
    }

    if (changes['periodFilter'] || changes['hourFilter']) {
      this.handlePeriodAndHourFiltersChange();
    }

    if (changes['rubricasFormValues']) {
      const rubricas = this.rubricasFormValues();
      if (rubricas) {
        this.handleCategoriesChange(rubricas);
      }
    }
  }

  ngAfterViewInit(): void {
    // Only initialize map in the browser (OpenLayers doesn't work during SSR)
    if (this.isBrowser) {
      this.initializeMap();
    }
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.censusMap.set(null);
    this.disposeHeatmapLayer();
    if (this.temporalRenderKey) unByKey(this.temporalRenderKey);
    this.cancelDrawing();
    this.areaSource.clear();
    this.areaLayer?.dispose();
    this.destroy$.next();
    this.destroy$.complete();
    this.cancelPendingTileRequests();

    if (this.tileLayerUpdateTimer !== null) {
      clearTimeout(this.tileLayerUpdateTimer);
      this.tileLayerUpdateTimer = null;
    }

    if (this.moveEndListenerKey) {
      unByKey(this.moveEndListenerKey);
      this.moveEndListenerKey = null;
    }

    if (this.tileLoadEndListenerKey) {
      unByKey(this.tileLoadEndListenerKey);
      this.tileLoadEndListenerKey = null;
    }

    // Dispose tile layer and cancel pending tile requests
    if (this.tileLayer) {
      this.olMap?.removeLayer(this.tileLayer);
      const source = this.tileLayer.getSource();
      if (source) {
        source.clear();
      }
      this.tileLayer.dispose();
      this.tileLayer = null;
      this.tileSource = null;
    }

    this.disposeClusterLayer();

    // Dispose the OpenLayers map
    if (this.olMap) {
      this.mapSetupService.disposeMapState(this.olMap);
      this.olMap.setTarget(undefined);
      this.olMap.dispose();
      this.olMap = null;
    }
  }
  private initializeMap(): void {
    this.olMap = this.mapSetupService.setupMap(this.document);

    if (!this.olMap) return;
    this.censusMap.set(this.olMap);

    this.areaLayer = new VectorLayer({
      source: this.areaSource,
      style: new Style({
        stroke: new Stroke({ color: '#1565c0', width: 3 }),
        fill: new Fill({ color: 'rgba(21, 101, 192, 0.12)' }),
      }),
      zIndex: 100,
    });
    this.olMap.addLayer(this.areaLayer);

    // Listen for map moveend to emit bounds changes
    this.moveEndListenerKey = this.olMap.on('moveend', () => {
      this.emitCurrentBounds();
      this.scheduleVisibleClusterRefresh(this.tileLayerVersion);
    });

    // Initialize with empty tile layer (will be updated when filters change)
    this.updateTileLayer();

    // Emit initial bounds
    this.emitCurrentBounds();
  }
  private emitCurrentBounds(): void {
    if (this.isDestroyed || !this.olMap) return;

    const extent = this.olMap.getView().calculateExtent(this.olMap.getSize());
    const [minX, minY, maxX, maxY] = extent;

    // Convert from Web Mercator (3857) to WGS84 (4326)
    const [minLon, minLat] = toLonLat([minX, minY]);
    const [maxLon, maxLat] = toLonLat([maxX, maxY]);

    const bounds = {
      minLon,
      minLat,
      maxLon,
      maxLat,
      zoom: this.olMap.getView().getZoom() ?? 0,
    };

    this.boundsChange.emit(bounds);
  }

  private handleAddressCenterChange(): void {
    if (!this.olMap) return;

    const center = this.addressCenter();
    this.showIndeterminateProgressBar().set(false);
    this.progressBarPercentage().set(0);

    if (center.lon != null && center.lat != null) {
      const projectedCenter = fromLonLat([center.lon, center.lat]);
      this.olMap.getView().animate({
        center: projectedCenter,
        zoom: DEFAULT_ZOOM,
        duration: 300,
      });
    }

    this.progressBarPercentage().set(-1);
  }
  private handleDateFiltersChange(): void {
    const filters = this.dateFilters();

    this.currentFilters.set({
      ...this.currentFilters(),
      before: filters.before
        ? this.dateService.formatYYYYMMDD(filters.before)
        : undefined,
      after: filters.after
        ? this.dateService.formatYYYYMMDD(filters.after)
        : undefined,
    });

    this.scheduleTileLayerUpdate();

    this.progressBarPercentage().set(-1);
  }

  private handleDatasetRevisionChange(): void {
    const revision = this.datasetRevision();
    if (this.currentFilters().datasetRevision === revision) return;

    this.currentFilters.set({
      ...this.currentFilters(),
      datasetRevision: revision ?? undefined,
    });
    this.scheduleTileLayerUpdate();
  }
  private handlePeriodAndHourFiltersChange(): void {
    const period = this.periodFilter();
    const hour = this.hourFilter();

    this.currentFilters.set({
      ...this.currentFilters(),
      periods: period ? [period] : undefined,
      startHour: hour.enabled ? hour.startHour : undefined,
      endHour: hour.enabled ? hour.endHour : undefined,
    });

    this.scheduleTileLayerUpdate();
    this.progressBarPercentage().set(-1);
  }
  private handleCategoriesChange(rubricasFormValues: {
    [key: string]: boolean;
  }): void {
    const selectedCategories = Object.entries(rubricasFormValues)
      .filter(([, selected]) => selected)
      .map(([category]) => category);

    this.activeCategories.set(selectedCategories);

    this.currentFilters.set({
      ...this.currentFilters(),
      categories:
        selectedCategories.length > 0 ? selectedCategories : undefined,
    });

    this.scheduleTileLayerUpdate();
  }
  private scheduleTileLayerUpdate(): void {
    if (!this.olMap || this.isDestroyed) return;

    if (this.tileLayerUpdateTimer !== null) {
      clearTimeout(this.tileLayerUpdateTimer);
    }

    this.tileLayerUpdateTimer = setTimeout(() => {
      this.tileLayerUpdateTimer = null;
      this.updateTileLayer();
    }, TILE_LAYER_UPDATE_DEBOUNCE_MS);
  }
  private updateTileLayer(): void {
    if (!this.olMap) return;

    this.cancelPendingTileRequests();
    this.tileLayerVersion++;
    if (this.temporalRenderKey) unByKey(this.temporalRenderKey);
    this.temporalRenderKey = null;
    this.temporalDates = {
      after: this.currentFilters().after ?? null,
      before: this.currentFilters().before ?? null,
    };
    this.emitTemporalState('loading');
    const tileLayerVersion = this.tileLayerVersion;
    this.tileTimeoutDialogOpen = false;
    this.tileError.set(null);
    this.tileCompleteness.set(false);
    this.disposeClusterLayer();
    this.disposeHeatmapLayer();

    if (this.tileLoadEndListenerKey) {
      unByKey(this.tileLoadEndListenerKey);
      this.tileLoadEndListenerKey = null;
    }

    const filters = this.currentFilters();
    const density = this.displayMode() === 'density';
    const heatmap = this.displayMode() === 'heatmap';
    const style = heatmap
      ? new Style({})
      : density
      ? createDensityStyleFunction()
      : createOccurrenceStyleFunction(this.activeCategories(), (category) =>
          this.markersService.markerChooser(category)
        );

    // Don't show layer if no categories are selected
    if (!filters.categories || filters.categories.length === 0) {
      if (this.tileLayer) {
        this.olMap.removeLayer(this.tileLayer);
        this.tileLayer.getSource()?.clear();
      }
      return;
    }

    const tileUrl = this.vectorTileService.buildTileUrl(filters);
    const tileLoadFunction = this.createTileLoadFunction(
      tileLayerVersion,
      this.tileRequestCancellation$
    );
    const existingSource = this.tileSource;
    const source =
      existingSource ??
      new VectorTileSource({
        format: new MVTFormat({
          // Don't use idProperty - we need num_bo as a regular property for click handling
          layers: ['occurrences'], // Must match the layer name in ST_AsMVT
        }),
        url: tileUrl,
        maxZoom: MAX_CRIME_TILE_ZOOM,
        cacheSize: TILE_SOURCE_CACHE_SIZE,
        transition: 0,
        tileLoadFunction,
      });

    this.tileSource = source;
    if (existingSource) {
      // The source is intentionally reused between filter changes. Clear its
      // old tile entries and replace the loader so stale requests are tied to
      // the new cancellation/version boundary.
      source.setUrl(tileUrl);
      source.setTileLoadFunction(tileLoadFunction);
      source.clear();
    }

    this.tileLoadEndListenerKey = source.on('tileloadend', () => {
      this.scheduleVisibleClusterRefresh(tileLayerVersion);
    });

    if (!this.tileLayer) {
      this.tileLayer = new VectorTileLayer({
        source,
        style,
        declutter: false,
        renderMode: 'hybrid',
        preload: 0,
        minZoom: TILE_LAYER_MIN_ZOOM,
        maxZoom: LAYER_MAX_ZOOM,
      });
    } else {
      this.tileLayer.setStyle(style);
    }

    this.tileLayer.set(MAP_INTERACTIVE_LAYER_PROPERTY, !density && !heatmap);
    if (!this.olMap.getLayers().getArray().includes(this.tileLayer)) {
      this.olMap.addLayer(this.tileLayer);
    }
    if (this.displayMode() === 'auto') {
      this.clusterLayer = this.createClusterLayer(this.activeCategories());
      this.olMap.addLayer(this.clusterLayer);
    }
    if (heatmap) {
      this.heatmapLayer = createOccurrenceHeatmap(
        new VectorSource<Feature<Point>>({ wrapX: false })
      );
      this.heatmapLayer.setMinZoom(TILE_LAYER_MIN_ZOOM);
      this.heatmapLayer.setMaxZoom(LAYER_MAX_ZOOM);
      this.olMap.addLayer(this.heatmapLayer);
      this.heatmapRenderKey = this.tileLayer.on('postrender', () =>
        this.scheduleVisibleClusterRefresh(tileLayerVersion)
      );
    }
    this.scheduleVisibleClusterRefresh(tileLayerVersion);
    this.temporalRenderKey = this.olMap.once('rendercomplete', () => {
      this.temporalRenderKey = null;
      if (tileLayerVersion === this.tileLayerVersion) {
        this.emitTemporalState(
          this.tileError() || this.tileCompleteness() ? 'error' : 'ready'
        );
      }
    });
  }

  private emitTemporalState(status: TemporalMapState['status']): void {
    this.temporalState.emit({ ...this.temporalDates, status });
  }

  private disposeHeatmapLayer(): void {
    if (this.heatmapRenderKey) unByKey(this.heatmapRenderKey);
    this.heatmapRenderKey = null;
    if (!this.heatmapLayer) return;
    this.olMap?.removeLayer(this.heatmapLayer);
    this.heatmapLayer.getSource()?.clear();
    this.heatmapLayer.getSource()?.dispose();
    this.heatmapLayer.dispose();
    this.heatmapLayer = null;
  }

  private cancelPendingTileRequests(): void {
    this.tileRequestCancellation$.next();
    this.tileRequestCancellation$.complete();
    this.tileRequestCancellation$ = new Subject<void>();
  }

  private createTileLoadFunction(
    tileLayerVersion: number,
    cancellation$: Subject<void>
  ): LoadFunction {
    return createVectorTileLoadFunction({
      http: this.http,
      tileLayerVersion,
      cancellation$,
      onTimeout: (version) => this.openTileTimeoutDialog(version),
      onCompleteness: (version, tileUrl, completeness) =>
        this.recordTileCompleteness(version, tileUrl, completeness),
      shouldMarkTileError: (version) =>
        !this.isDestroyed && version === this.tileLayerVersion,
      isCancelled: () =>
        this.isDestroyed || tileLayerVersion !== this.tileLayerVersion,
      onError: (error) => {
        this.handleTileLoadError(error, tileLayerVersion);
        if (
          error.kind !== 'cancelled' &&
          tileLayerVersion === this.tileLayerVersion
        )
          this.emitTemporalState('error');
        if (error.kind !== 'cancelled') {
          console.warn('[MapComponent] Vector tile load failed', {
            kind: error.kind,
            status: error.status,
            url: error.tileUrl,
            tileLayerVersion,
          });
        }
      },
    });
  }

  private openTileTimeoutDialog(tileLayerVersion: number): void {
    if (
      this.isDestroyed ||
      tileLayerVersion !== this.tileLayerVersion ||
      this.tileTimeoutDialogOpen
    ) {
      return;
    }

    this.tileTimeoutDialogOpen = true;

    void import(
      './components/tile-timeout-dialog/tile-timeout-dialog.component'
    )
      .then(({ TileTimeoutDialogComponent }) => {
        if (this.isDestroyed || tileLayerVersion !== this.tileLayerVersion) {
          this.tileTimeoutDialogOpen = false;
          return;
        }

        this.dialog
          .open(TileTimeoutDialogComponent, {
            width: 'min(420px, calc(100vw - 32px))',
          })
          .afterClosed()
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.tileTimeoutDialogOpen = false;
            },
            error: (error: unknown) => {
              this.tileTimeoutDialogOpen = false;
              console.error('[MapComponent] Tile timeout dialog failed', error);
            },
          });
      })
      .catch((error: unknown) => {
        this.tileTimeoutDialogOpen = false;
        console.error('[MapComponent] Tile timeout dialog chunk failed', error);
      });
  }

  private createClusterLayer(
    activeCategories: string[]
  ): VectorLayer<ClusterSource<Feature<Point>>, FeatureLike> {
    this.clusterFeatureSource = new VectorSource<Feature<Point>>({
      wrapX: false,
    });

    const clusterSource = new ClusterSource<Feature<Point>>({
      source: this.clusterFeatureSource,
      distance: CLUSTER_DISTANCE_PX,
      minDistance: CLUSTER_MIN_DISTANCE_PX,
    });

    const clusterLayer = new VectorLayer({
      source: clusterSource,
      style: createClusterStyleFunction(activeCategories, (category) =>
        this.markersService.markerChooser(category)
      ),
      declutter: true,
      zIndex: 100,
      minZoom: CLIENT_CLUSTER_LAYER_MIN_ZOOM,
      maxZoom: LAYER_MAX_ZOOM,
    });

    clusterLayer.set(MAP_INTERACTIVE_LAYER_PROPERTY, true);
    return clusterLayer;
  }

  private addClusterFeatures(
    features: FeatureLike[],
    activeCategories: ReadonlySet<string>
  ): void {
    const clusterFeatureSource = this.clusterFeatureSource;
    if (!clusterFeatureSource) return;

    const featuresToAdd: Feature<Point>[] = [];
    features.forEach((feature) => {
      if (!shouldIncludeClientClusterFeature(feature, activeCategories)) return;

      const coordinate = getFeatureCoordinate(feature);
      if (!coordinate) return;

      const key = getClusterFeatureKey(feature, coordinate);
      if (this.loadedClusterFeatureKeys.has(key)) return;

      this.loadedClusterFeatureKeys.add(key);
      featuresToAdd.push(createClientClusterFeature(feature, coordinate));
    });

    if (featuresToAdd.length > 0) {
      clusterFeatureSource.addFeatures(featuresToAdd);
    }
  }

  private disposeClusterLayer(): void {
    if (this.clusterRefreshAnimationFrame !== null) {
      cancelAnimationFrame(this.clusterRefreshAnimationFrame);
      this.clusterRefreshAnimationFrame = null;
    }

    if (this.tileLoadEndListenerKey) {
      unByKey(this.tileLoadEndListenerKey);
      this.tileLoadEndListenerKey = null;
    }

    if (this.clusterLayer && this.olMap) {
      this.olMap.removeLayer(this.clusterLayer);
    }

    const clusterSource = this.clusterLayer?.getSource();
    clusterSource?.setSource(null);
    clusterSource?.clear();
    this.clusterLayer?.dispose();
    this.clusterLayer = null;
    this.clusterFeatureSource?.clear();
    this.clusterFeatureSource?.dispose();
    this.clusterFeatureSource = null;
    this.loadedClusterFeatureKeys.clear();
  }

  private scheduleVisibleClusterRefresh(tileLayerVersion: number): void {
    if (this.clusterRefreshAnimationFrame !== null) return;

    this.clusterRefreshAnimationFrame = requestAnimationFrame(() => {
      this.clusterRefreshAnimationFrame = null;
      this.refreshVisibleClusterFeatures(tileLayerVersion);
    });
  }

  retryTileLoads(): void {
    if (this.isDestroyed) return;

    this.tileError.set(null);
    this.tileCompleteness.set(false);
    this.tileSource?.clear();
    this.scheduleVisibleClusterRefresh(this.tileLayerVersion);
  }

  private handleTileLoadError(
    error: VectorTileLoadError,
    tileLayerVersion: number
  ): void {
    if (
      this.isDestroyed ||
      tileLayerVersion !== this.tileLayerVersion ||
      error.kind === 'cancelled'
    ) {
      return;
    }

    if (error.kind === 'http' && error.status === 429) {
      this.tileError.set(
        'O servidor limitou o carregamento de uma parte do mapa. Tente novamente.'
      );
      return;
    }

    this.tileError.set(
      'Não foi possível carregar uma parte do mapa. Tente novamente.'
    );
  }

  private recordTileCompleteness(
    tileLayerVersion: number,
    _tileUrl: string,
    completeness: TileCompleteness
  ): void {
    if (this.isDestroyed || tileLayerVersion !== this.tileLayerVersion) return;

    if (completeness.truncated) this.tileCompleteness.set(true);
  }

  private updateVisibleTileCompleteness(features: FeatureLike[]): void {
    this.tileCompleteness.set(
      features.some((feature) => {
        const truncated = feature.get('truncated');
        return (
          truncated === true ||
          truncated === 1 ||
          truncated === '1' ||
          truncated === 'true'
        );
      })
    );
  }

  private refreshVisibleClusterFeatures(tileLayerVersion: number): void {
    if (
      this.isDestroyed ||
      tileLayerVersion !== this.tileLayerVersion ||
      !this.olMap ||
      !this.tileLayer
    ) {
      return;
    }

    const mapSize = this.olMap.getSize();
    if (!mapSize) return;

    const extent = this.olMap.getView().calculateExtent(mapSize);
    if (this.heatmapLayer) {
      const margin =
        (HEATMAP_RADIUS + HEATMAP_BLUR) *
        (this.olMap.getView().getResolution() ?? 0);
      const points = this.tileLayer.getFeaturesInExtent(buffer(extent, margin));
      this.updateVisibleTileCompleteness(points);
      const source = this.heatmapLayer.getSource();
      if (source) synchronizeHeatmapPoints(source, points);
      return;
    }
    const features = this.tileLayer.getFeaturesInExtent(extent);
    this.updateVisibleTileCompleteness(features);

    if (
      !this.clusterFeatureSource ||
      (this.olMap.getView().getZoom() ?? 0) < CLIENT_CLUSTER_LAYER_MIN_ZOOM
    ) {
      return;
    }

    this.loadedClusterFeatureKeys.clear();
    this.clusterFeatureSource.clear(true);
    this.addClusterFeatures(features, new Set(this.activeCategories()));
  }
}
