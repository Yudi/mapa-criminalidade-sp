import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Feature, { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import View from 'ol/View';
import { Pixel } from 'ol/pixel';
import { MapMarkersService } from '../../../shared/map-markers.service';
import type { FeatureDetailDialogData } from '../components/feature-detail-dialog/feature-detail-dialog.component';
import { getFeatureCoordinate } from '../utils/map-cluster.utils';
import { preloadNextZoomTiles } from '../utils/map-cluster-preload.utils';
import { MAP_INTERACTIVE_LAYER_PROPERTY } from '../utils/map-layer.constants';
import {
  getSpreadPixelOffsets,
  SPREAD_ANIMATION_MS,
  SPREAD_MARKER_PROPERTY,
} from '../utils/map-spread.utils';

const DEFAULT_COORDINATES: [number, number] = [-46.63394714, -23.5503953];
const DEFAULT_ZOOM = 16;
const MAX_ZOOM = 19;
const HIT_TOLERANCE = 4;
const SUPPRESSED_CLUSTER_MEMBER_PROPERTY = 'suppressedClusterMember';
const CLUSTER_FEATURES_PROPERTY = 'features';
const SERVER_CLUSTER_COUNT_PROPERTY = 'cluster_count';

@Injectable({
  providedIn: 'root',
})
export class VectorTileMapSetupService {
  private readonly dialog = inject(MatDialog);
  private readonly markersService = inject(MapMarkersService);

  private spreadLayer: VectorLayer<VectorSource<Feature<Point>>> | null = null;
  private spreadAnimationFrame: number | null = null;
  private cursorAnimationFrame: number | null = null;
  private pendingCursorPixel: Pixel | null = null;
  private lastCursorState: boolean | null = null;
  private suppressedClusterMembers: Feature[] = [];

  setupMap(document: Document): Map {
    const rasterLayer = new TileLayer({
      source: new OSM(),
    });

    const olMap = new Map({
      view: new View({
        center: fromLonLat(DEFAULT_COORDINATES),
        zoom: DEFAULT_ZOOM,
        maxZoom: MAX_ZOOM,
        projection: 'EPSG:3857',
      }),
      layers: [rasterLayer],
      target: 'ol-map-tab',
    });

    olMap.on('singleclick', (event) => {
      const features = olMap.getFeaturesAtPixel(event.pixel, {
        hitTolerance: HIT_TOLERANCE,
        layerFilter: (layer) =>
          layer.get(MAP_INTERACTIVE_LAYER_PROPERTY) === true,
      });

      if (!features || features.length === 0) {
        this.clearSpreadLayer(olMap);
        return;
      }

      const spreadFeature = features.find((feature) =>
        this.isSpreadFeature(feature)
      );

      if (spreadFeature) {
        this.openFeatureFromFeature(spreadFeature);
        return;
      }

      const clusterFeature = features.find((feature) =>
        this.isClusterFeature(feature)
      );

      if (clusterFeature) {
        void this.handleClusterFeatureClick(olMap, clusterFeature);
        return;
      }

      const clickableFeatures = this.getUniqueClickableFeatures(features);

      if (clickableFeatures.length === 0) {
        this.clearSpreadLayer(olMap);
        return;
      }

      if (clickableFeatures.length === 1) {
        this.openFeatureFromFeature(clickableFeatures[0]);
        this.clearSpreadLayer(olMap);
        return;
      }

      this.spreadFeatures(olMap, clickableFeatures, event.pixel);
    });

    olMap.on('movestart', () => {
      this.restoreSuppressedClusterMembers();
      this.clearSpreadLayer(olMap);
    });

    // Change cursor on hover
    olMap.on('pointermove', (e) => {
      this.pendingCursorPixel = olMap.getEventPixel(e.originalEvent);

      if (this.cursorAnimationFrame !== null) return;

      this.cursorAnimationFrame = requestAnimationFrame(() => {
        this.cursorAnimationFrame = null;
        const pixel = this.pendingCursorPixel;
        this.pendingCursorPixel = null;

        if (!pixel) return;

        const hasFeature = this.hasFeatureAtPixelSafely(olMap, pixel);

        if (hasFeature === this.lastCursorState) return;

        this.lastCursorState = hasFeature;
        const element = document.getElementById(olMap.getTarget() as string);
        if (element) {
          element.style.cursor = hasFeature ? 'pointer' : '';
        }
      });
    });

    return olMap;
  }

  disposeMapState(olMap: Map): void {
    if (this.cursorAnimationFrame !== null) {
      cancelAnimationFrame(this.cursorAnimationFrame);
      this.cursorAnimationFrame = null;
    }

    this.pendingCursorPixel = null;
    this.lastCursorState = null;
    this.clearSpreadLayer(olMap);
    this.restoreSuppressedClusterMembers();
  }

  private hasFeatureAtPixelSafely(olMap: Map, pixel: Pixel): boolean {
    try {
      return olMap.hasFeatureAtPixel(pixel, {
        hitTolerance: HIT_TOLERANCE,
        layerFilter: (layer) =>
          layer.get(MAP_INTERACTIVE_LAYER_PROPERTY) === true,
      });
    } catch (error) {
      if (
        error instanceof TypeError &&
        error.message.includes('hasRenderer')
      ) {
        olMap.render();
        return false;
      }

      throw error;
    }
  }

  private async handleClusterFeatureClick(
    olMap: Map,
    clusterFeature: FeatureLike
  ): Promise<void> {
    if (this.isServerClusterFeature(clusterFeature)) {
      const clusterCoordinate = this.getPointCoordinate(clusterFeature);
      this.clearSpreadLayer(olMap);

      if (clusterCoordinate && this.canZoomIn(olMap)) {
        await preloadNextZoomTiles(olMap, clusterCoordinate);
        this.zoomIntoCluster(olMap, clusterCoordinate);
      }
      return;
    }

    const clusteredFeatures = this.getClusteredFeatures(clusterFeature);
    const clusterCoordinate = this.getPointCoordinate(clusterFeature);

    if (clusteredFeatures.length === 0 || !clusterCoordinate) {
      this.clearSpreadLayer(olMap);
      return;
    }

    const clickableFeatures = this.getUniqueClickableFeatures(clusteredFeatures);

    if (clickableFeatures.length === 0) {
      this.clearSpreadLayer(olMap);
      return;
    }

    if (clickableFeatures.length === 1) {
      this.openFeatureFromFeature(clickableFeatures[0]);
      this.clearSpreadLayer(olMap);
      return;
    }

    if (this.canZoomIn(olMap)) {
      this.clearSpreadLayer(olMap);
      this.zoomIntoCluster(olMap, clusterCoordinate);
      return;
    }

    this.clearSpreadLayer(olMap);
    this.suppressClusterMembers(clusteredFeatures);
    this.spreadFeatures(
      olMap,
      clickableFeatures,
      olMap.getPixelFromCoordinate(clusterCoordinate),
      false
    );
  }

  private spreadFeatures(
    olMap: Map,
    features: FeatureLike[],
    originPixel: Pixel,
    clearExistingSpread = true
  ): void {
    if (clearExistingSpread) {
      this.clearSpreadLayer(olMap);
    }

    const source = new VectorSource<Feature<Point>>();
    const offsets = getSpreadPixelOffsets(features.length);
    const originCoordinate = olMap.getCoordinateFromPixel(originPixel);
    const spreadFeatures: {
      feature: Feature<Point>;
      targetCoordinate: [number, number];
    }[] = [];

    features.forEach((feature, index) => {
      const [offsetX, offsetY] = offsets[index];
      const coordinate = olMap.getCoordinateFromPixel([
        originPixel[0] + offsetX,
        originPixel[1] + offsetY,
      ]) as [number, number];
      const spreadFeature = new Feature({
        geometry: new Point(originCoordinate),
      });
      const props = this.getSpreadProperties(feature);
      spreadFeature.setProperties({
        ...props,
        [SPREAD_MARKER_PROPERTY]: true,
      });
      spreadFeature.setStyle(this.createFeatureStyle(feature));
      source.addFeature(spreadFeature);
      spreadFeatures.push({ feature: spreadFeature, targetCoordinate: coordinate });
    });

    this.spreadLayer = new VectorLayer({
      source,
      zIndex: 1000,
    });
    this.spreadLayer.set(MAP_INTERACTIVE_LAYER_PROPERTY, true);
    olMap.addLayer(this.spreadLayer);
    this.animateSpreadFeatures(olMap, this.spreadLayer, originCoordinate, spreadFeatures);
  }

  private animateSpreadFeatures(
    olMap: Map,
    layer: VectorLayer<VectorSource<Feature<Point>>>,
    originCoordinate: number[],
    spreadFeatures: {
      feature: Feature<Point>;
      targetCoordinate: [number, number];
    }[]
  ): void {
    const startedAt = performance.now();
    const [originX, originY] = originCoordinate;

    const step = (now: number) => {
      if (this.spreadLayer !== layer) return;

      const progress = Math.min((now - startedAt) / SPREAD_ANIMATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      spreadFeatures.forEach(({ feature, targetCoordinate }) => {
        const [targetX, targetY] = targetCoordinate;
        feature.getGeometry()?.setCoordinates([
          originX + (targetX - originX) * easedProgress,
          originY + (targetY - originY) * easedProgress,
        ]);
      });

      olMap.render();

      if (progress < 1) {
        this.spreadAnimationFrame = requestAnimationFrame(step);
      } else {
        this.spreadAnimationFrame = null;
      }
    };

    this.spreadAnimationFrame = requestAnimationFrame(step);
  }

  private canZoomIn(olMap: Map): boolean {
    const view = olMap.getView();
    const currentZoom = view.getZoom() ?? 0;
    const maxZoom = view.getMaxZoom();

    return currentZoom < maxZoom;
  }

  private zoomIntoCluster(olMap: Map, coordinate: [number, number]): void {
    const view = olMap.getView();
    const currentZoom = view.getZoom() ?? 0;
    const nextZoom = Math.min(Math.ceil(currentZoom + 1), view.getMaxZoom());

    view.animate({
      center: coordinate,
      zoom: nextZoom,
      duration: 250,
    });
  }

  private getUniqueClickableFeatures(features: FeatureLike[]): FeatureLike[] {
    const seen = new Set<string>();
    const clickableFeatures: FeatureLike[] = [];

    features.forEach((feature) => {
      if (this.isSpreadFeature(feature)) return;

      const data = this.getFeatureDialogData(feature);
      if (!data) return;

      const key = `${data.numBo}:${data.anoBo}:${data.delegacia ?? ''}`;
      if (seen.has(key)) return;

      seen.add(key);
      clickableFeatures.push(feature);
    });

    return clickableFeatures;
  }

  private openFeatureFromFeature(feature: FeatureLike): void {
    const data = this.getFeatureDialogData(feature);

    if (!data) {
      console.warn(
        '[VectorTileMapSetupService] Missing num_bo or ano_bo in feature properties'
      );
      return;
    }

    // delegacia is the registration police unit required for older BO identity.
    this.openFeatureDialog(data);
  }

  private getFeatureDialogData(
    feature: FeatureLike
  ): FeatureDetailDialogData | null {
    const numBo = feature.get('num_bo') as string | undefined;
    const anoBo = feature.get('ano_bo') as number | string | undefined;
    const delegacia = feature.get('delegacia') as string | undefined;

    if (!numBo || !anoBo) return null;

    const parsedAnoBo =
      typeof anoBo === 'number' ? anoBo : Number.parseInt(anoBo, 10);

    if (Number.isNaN(parsedAnoBo)) return null;

    return {
      numBo,
      anoBo: parsedAnoBo,
      delegacia,
    };
  }

  private getSpreadProperties(feature: FeatureLike): Record<string, unknown> {
    return {
      num_bo: feature.get('num_bo'),
      ano_bo: feature.get('ano_bo'),
      delegacia: feature.get('delegacia'),
      category: feature.get('category'),
    };
  }

  private createFeatureStyle(feature: FeatureLike): Style {
    const category = feature.get('category') as string | undefined;
    const iconPath = this.markersService.markerChooser(category ?? '');

    return new Style({
      image: new Icon({
        anchor: [0.5, 1],
        scale: 0.2,
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
        src: iconPath,
      }),
    });
  }

  private isSpreadFeature(feature: FeatureLike): boolean {
    return feature.get(SPREAD_MARKER_PROPERTY) === true;
  }

  private isClusterFeature(feature: FeatureLike): boolean {
    return (
      this.isServerClusterFeature(feature) ||
      this.getClusteredFeatures(feature).length > 0
    );
  }

  private isServerClusterFeature(feature: FeatureLike): boolean {
    return Number(feature.get(SERVER_CLUSTER_COUNT_PROPERTY) ?? 1) > 1;
  }

  private getClusteredFeatures(feature: FeatureLike): FeatureLike[] {
    const clusteredFeatures = feature.get(CLUSTER_FEATURES_PROPERTY) as
      | FeatureLike[]
      | undefined;

    return Array.isArray(clusteredFeatures) ? clusteredFeatures : [];
  }

  private getPointCoordinate(feature: FeatureLike): [number, number] | null {
    return getFeatureCoordinate(feature);
  }

  private suppressClusterMembers(features: FeatureLike[]): void {
    this.restoreSuppressedClusterMembers();

    this.suppressedClusterMembers = features.filter(
      (feature): feature is Feature => feature instanceof Feature
    );

    this.suppressedClusterMembers.forEach((feature) => {
      feature.set(SUPPRESSED_CLUSTER_MEMBER_PROPERTY, true);
      feature.changed();
    });
  }

  private restoreSuppressedClusterMembers(): void {
    if (this.suppressedClusterMembers.length === 0) return;

    this.suppressedClusterMembers.forEach((feature) => {
      feature.set(SUPPRESSED_CLUSTER_MEMBER_PROPERTY, false);
      feature.changed();
    });
    this.suppressedClusterMembers = [];
  }

  private clearSpreadLayer(olMap: Map): void {
    if (this.spreadAnimationFrame !== null) {
      cancelAnimationFrame(this.spreadAnimationFrame);
      this.spreadAnimationFrame = null;
    }

    const spreadLayer = this.spreadLayer;
    this.spreadLayer = null;
    this.restoreSuppressedClusterMembers();

    if (!spreadLayer) return;

    olMap.removeLayer(spreadLayer);
    spreadLayer.getSource()?.clear();
    spreadLayer.dispose();
    olMap.render();
  }

  private async openFeatureDialog(data: FeatureDetailDialogData): Promise<void> {
    const { FeatureDetailDialogComponent } = await import(
      '../components/feature-detail-dialog/feature-detail-dialog.component'
    );

    this.dialog.open(FeatureDetailDialogComponent, {
      data,
      width: '700px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'feature-detail-dialog',
    });
  }
}
