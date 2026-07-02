import {
  AfterViewInit,
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
import { MatDialog } from '@angular/material/dialog';
import OlMap from 'ol/Map';
import { fromLonLat, toLonLat } from 'ol/proj';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorLayer from 'ol/layer/Vector';
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
import type { LoadFunction } from 'ol/Tile';

import { MapMarkersService } from '../../shared/map-markers.service';
import {
  VectorTileService,
  ExtendedTileFilterParams,
} from '../../shared/vector-tile.service';
import {
  VectorTileMapSetupService,
} from './services/vector-tile-map-setup.service';
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
import { createVectorTileLoadFunction } from './utils/map-tile-loader.utils';
const DEFAULT_ZOOM = 16;
const MAP_MAX_ZOOM = 19;
const LAYER_MAX_ZOOM = MAP_MAX_ZOOM + 1;
const CLIENT_CLUSTER_MIN_ZOOM = 16;
const CLUSTER_DISTANCE_PX = 44;
const CLUSTER_MIN_DISTANCE_PX = 28;
const TILE_LAYER_UPDATE_DEBOUNCE_MS = 200;
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
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly addressCenter = input.required<{
    lon: number | null;
    lat: number | null;
  }>();

  readonly dateFilters = input.required<{
    before: string | null;
    after: string | null;
  }>();
  readonly periodFilter = input.required<string | null>();
  readonly hourFilter = input.required<HourFilter>();

  readonly rubricasFormValues = input.required<
    { [key: string]: boolean } | undefined
  >();
  readonly showIndeterminateProgressBar =
    input.required<WritableSignal<boolean>>();
  readonly progressBarPercentage = input.required<WritableSignal<number>>();
  readonly boundsChange = output<MapBounds>();

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

  private moveEndListenerKey: EventsKey | null = null;
  private tileLoadEndListenerKey: EventsKey | null = null;
  private isDestroyed = false;
  private activeCategories = signal<string[]>([]);
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
    const tileLayerVersion = this.tileLayerVersion;
    this.tileTimeoutDialogOpen = false;
    this.disposeClusterLayer();

    if (this.tileLoadEndListenerKey) {
      unByKey(this.tileLoadEndListenerKey);
      this.tileLoadEndListenerKey = null;
    }

    if (this.tileLayer) {
      this.olMap.removeLayer(this.tileLayer);
      this.tileLayer.getSource()?.clear();
      this.tileLayer.dispose();
    }

    const filters = this.currentFilters();

    // Don't show layer if no categories are selected
    if (!filters.categories || filters.categories.length === 0) {
      this.tileLayer = null;
      return;
    }

    const tileUrl = this.vectorTileService.buildTileUrl(filters);

    const source = new VectorTileSource({
      format: new MVTFormat({
        // Don't use idProperty - we need num_bo as a regular property for click handling
        layers: ['occurrences'], // Must match the layer name in ST_AsMVT
      }),
      url: tileUrl,
      maxZoom: MAX_CRIME_TILE_ZOOM,
      cacheSize: 512,
      transition: 0,
      tileLoadFunction: this.createTileLoadFunction(
        tileLayerVersion,
        this.tileRequestCancellation$
      ),
    });

    this.tileLoadEndListenerKey = source.on('tileloadend', () => {
      this.scheduleVisibleClusterRefresh(tileLayerVersion);
    });

    this.tileLayer = new VectorTileLayer({
      source,
      style: createOccurrenceStyleFunction(
        this.activeCategories(),
        (category) => this.markersService.markerChooser(category)
      ),
      declutter: false,
      renderMode: 'hybrid',
      preload: 0,
      minZoom: MIN_CRIME_TILE_ZOOM,
      maxZoom: LAYER_MAX_ZOOM,
    });

    this.tileLayer.set(MAP_INTERACTIVE_LAYER_PROPERTY, true);
    this.clusterLayer = this.createClusterLayer(this.activeCategories());
    this.olMap.addLayer(this.tileLayer);
    this.olMap.addLayer(this.clusterLayer);
    this.scheduleVisibleClusterRefresh(tileLayerVersion);
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
      shouldMarkTileError: (version) =>
        !this.isDestroyed && version === this.tileLayerVersion,
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
    ).then(({ TileTimeoutDialogComponent }) => {
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
        .subscribe(() => {
          this.tileTimeoutDialogOpen = false;
        });
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
      minZoom: CLIENT_CLUSTER_MIN_ZOOM,
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

    features.forEach((feature) => {
      if (!shouldIncludeClientClusterFeature(feature, activeCategories)) return;

      const coordinate = getFeatureCoordinate(feature);
      if (!coordinate) return;

      const key = getClusterFeatureKey(feature, coordinate);
      if (this.loadedClusterFeatureKeys.has(key)) return;

      this.loadedClusterFeatureKeys.add(key);
      clusterFeatureSource.addFeature(
        createClientClusterFeature(feature, coordinate)
      );
    });
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

  private refreshVisibleClusterFeatures(tileLayerVersion: number): void {
    if (
      this.isDestroyed ||
      tileLayerVersion !== this.tileLayerVersion ||
      !this.olMap ||
      !this.tileLayer ||
      !this.clusterFeatureSource ||
      (this.olMap.getView().getZoom() ?? 0) < CLIENT_CLUSTER_MIN_ZOOM
    ) {
      return;
    }

    const mapSize = this.olMap.getSize();
    if (!mapSize) return;

    const extent = this.olMap.getView().calculateExtent(mapSize);
    const features = this.tileLayer.getFeaturesInExtent(extent);

    this.loadedClusterFeatureKeys.clear();
    this.clusterFeatureSource.clear(true);
    this.addClusterFeatures(features, new Set(this.activeCategories()));
  }

}
