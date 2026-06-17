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
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';
import { firstValueFrom, Subject, take, takeUntil } from 'rxjs';
import { FeatureLike } from 'ol/Feature';
import { unByKey } from 'ol/Observable';
import { EventsKey } from 'ol/events';
import Point from 'ol/geom/Point';
import RenderFeature from 'ol/render/Feature';
import type OlVectorTile from 'ol/VectorTile';
import TileState from 'ol/TileState';
import type { LoadFunction } from 'ol/Tile';

import { MapMarkersService } from '../../shared/map-markers.service';
import {
  VectorTileService,
  ExtendedTileFilterParams,
} from '../../shared/vector-tile.service';
import {
  MAP_INTERACTIVE_LAYER_PROPERTY,
  VectorTileMapSetupService,
} from './services/vector-tile-map-setup.service';
import { DateService } from '../../shared/date.service';
import {
  MAX_CRIME_TILE_ZOOM,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
const DEFAULT_ZOOM = 16;
const MAP_MAX_ZOOM = 19;
const LAYER_MAX_ZOOM = MAP_MAX_ZOOM + 1;
const CLIENT_CLUSTER_MIN_ZOOM = 16;
const CLUSTER_DISTANCE_PX = 44;
const CLUSTER_MIN_DISTANCE_PX = 28;
const SUPPRESSED_CLUSTER_MEMBER_PROPERTY = 'suppressedClusterMember';
const TILE_STATUS_HEADER = 'X-Map-Tile-Status';
const HTTP_STATUS_NO_CONTENT = 204;
const SERVER_CLUSTER_PROPERTY = 'server_cluster';
const SERVER_SINGLETON_PROPERTY = 'server_singleton';
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
      style: this.createStyleFunction(this.activeCategories()),
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
    return (tile, url) => {
      const vectorTile = tile as OlVectorTile<FeatureLike>;

      vectorTile.setLoader(async (extent, _resolution, projection) => {
        try {
          const response = await firstValueFrom(
            this.http
              .get(url, {
                observe: 'response',
                responseType: 'arraybuffer',
              })
              .pipe(takeUntil(cancellation$))
          );
          const tileStatus = response.headers.get(TILE_STATUS_HEADER);

          if (tileStatus === 'timeout') {
            this.openTileTimeoutDialog(tileLayerVersion);
            vectorTile.setFeatures([]);
            return [];
          }

          if (response.status === HTTP_STATUS_NO_CONTENT) {
            vectorTile.setFeatures([]);
            return [];
          }

          const data = response.body;
          if (!data || data.byteLength === 0) {
            vectorTile.setFeatures([]);
            return [];
          }

          const features = vectorTile.getFormat().readFeatures(data, {
            extent,
            featureProjection: projection,
          });
          vectorTile.setFeatures(features);
          return features;
        } catch {
          if (!this.isDestroyed && tileLayerVersion === this.tileLayerVersion) {
            vectorTile.setState(TileState.ERROR);
          }
          return [];
        }
      });
    };
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
      style: this.createClusterStyleFunction(activeCategories),
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
      const category = feature.get('category') as string | undefined;
      if (
        !category ||
        !activeCategories.has(category) ||
        Number(feature.get(SERVER_CLUSTER_PROPERTY) ?? 0) === 1 ||
        Number(feature.get(SERVER_SINGLETON_PROPERTY) ?? 0) === 1
      ) {
        return;
      }

      const coordinate = this.getFeatureCoordinate(feature);
      if (!coordinate) return;

      const key = this.getClusterFeatureKey(feature, coordinate);
      if (this.loadedClusterFeatureKeys.has(key)) return;

      const clusterFeature = new Feature({
        geometry: new Point(coordinate),
      });
      clusterFeature.setProperties({
        num_bo: feature.get('num_bo'),
        ano_bo: feature.get('ano_bo'),
        delegacia: feature.get('delegacia'),
        category,
      });

      this.loadedClusterFeatureKeys.add(key);
      clusterFeatureSource.addFeature(clusterFeature);
    });
  }

  private getFeatureCoordinate(feature: FeatureLike): [number, number] | null {
    const geometry = feature.getGeometry();

    if (geometry instanceof Point) {
      const [x, y] = geometry.getCoordinates();
      return [x, y];
    }

    if (geometry instanceof RenderFeature && geometry.getType() === 'Point') {
      const [x, y] = geometry.getFlatCoordinates();
      return [x, y];
    }

    return null;
  }

  private getClusterFeatureKey(
    feature: FeatureLike,
    coordinate: [number, number]
  ): string {
    return [
      feature.get('num_bo'),
      feature.get('ano_bo'),
      feature.get('delegacia') ?? '',
      Math.round(coordinate[0]),
      Math.round(coordinate[1]),
    ].join(':');
  }

  private createClusterStyleFunction(
    activeCategories: string[]
  ): (feature: FeatureLike) => Style | Style[] {
    const singleFeatureStyle = this.createIconStyleFunction(activeCategories);
    const clusterStyleCache = new Map<number, Style>();
    const hiddenStyle = new Style({});

    return (feature: FeatureLike): Style | Style[] => {
      const clusteredFeatures = feature.get('features') as
        | Feature<Point>[]
        | undefined;

      if (!clusteredFeatures || clusteredFeatures.length === 0) {
        return hiddenStyle;
      }

      const visibleFeatures = clusteredFeatures.filter(
        (clusteredFeature) =>
          clusteredFeature.get(SUPPRESSED_CLUSTER_MEMBER_PROPERTY) !== true
      );

      if (visibleFeatures.length === 0) {
        return hiddenStyle;
      }

      if (visibleFeatures.length === 1) {
        return singleFeatureStyle(visibleFeatures[0]);
      }

      return this.getClusterStyle(visibleFeatures.length, clusterStyleCache);
    };
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

  private createStyleFunction(
    activeCategories: string[]
  ): (feature: FeatureLike) => Style | Style[] {
    const iconStyle = this.createIconStyleFunction(activeCategories);
    const clusterStyleCache = new Map<number, Style>();
    const hiddenStyle = new Style({});

    return (feature: FeatureLike): Style | Style[] => {
      const category = feature.get('category') as string;

      if (!activeCategories.includes(category)) {
        return hiddenStyle;
      }

      const clusterCount = Number(feature.get('cluster_count') ?? 1);
      const isServerCluster =
        Number(feature.get(SERVER_CLUSTER_PROPERTY) ?? 0) === 1;
      if (isServerCluster || clusterCount > 1) {
        return this.getClusterStyle(clusterCount, clusterStyleCache);
      }

      if (Number(feature.get(SERVER_SINGLETON_PROPERTY) ?? 0) !== 1) {
        return hiddenStyle;
      }

      return iconStyle(feature);
    };
  }

  private createIconStyleFunction(
    activeCategories: string[]
  ): (feature: FeatureLike) => Style {
    const styleCache = new Map<string, Style>();
    const hiddenStyle = new Style({});

    return (feature: FeatureLike): Style => {
      const category = feature.get('category') as string;
      if (!activeCategories.includes(category)) return hiddenStyle;

      const cached = styleCache.get(category);
      if (cached) return cached;

      const style = new Style({
        image: new Icon({
          anchor: [0.5, 1],
          scale: 0.2,
          anchorXUnits: 'fraction',
          anchorYUnits: 'fraction',
          src: this.markersService.markerChooser(category),
        }),
      });

      styleCache.set(category, style);
      return style;
    };
  }

  private getClusterStyle(
    count: number,
    styleCache: Map<number, Style>
  ): Style {
    const cached = styleCache.get(count);
    if (cached) return cached;

    const radius = count < 10 ? 14 : count < 100 ? 17 : 21;
    const style = new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: '#1565c0' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      text: new Text({
        text: count.toLocaleString('pt-BR'),
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#0d47a1', width: 3 }),
        font: '700 12px Inter, Arial, sans-serif',
      }),
    });

    styleCache.set(count, style);
    return style;
  }
}
