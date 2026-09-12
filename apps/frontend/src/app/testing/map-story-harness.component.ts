import { CensusService } from '../shared/census.service';
import { StoryCensusService } from './story-census.service';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import Feature from 'ol/Feature';
import OlMap from 'ol/Map';
import View from 'ol/View';
import CircleGeometry from 'ol/geom/Circle';
import Point from 'ol/geom/Point';
import Polygon, { fromCircle } from 'ol/geom/Polygon';
import BaseLayer from 'ol/layer/Base';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import ClusterSource from 'ol/source/Cluster';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import VectorSource from 'ol/source/Vector';
import { AnalysisArea, MapDisplayMode } from '@mapa-criminalidade/shared-types';
import { MapComponent } from '../components/map/map.component';
import { VectorTileMapSetupService } from '../components/map/services/vector-tile-map-setup.service';
import { createDensityStyleFunction } from '../components/map/utils/map-density-style.utils';
import { createOccurrenceHeatmap } from '../components/map/utils/map-heatmap.utils';
import {
  createClusterStyleFunction,
  createOccurrenceStyleFunction,
} from '../components/map/utils/map-style.utils';
import { MapMarkersService } from '../shared/map-markers.service';
import { MAP_INTERACTIVE_LAYER_PROPERTY } from '../components/map/utils/map-layer.constants';
import { MatDialog } from '@angular/material/dialog';
import { OccurrencesService } from '../shared/occurrences.service';
import { of } from 'rxjs';
import { StoryMapFeature, storyMapFeatures } from './storybook.fixtures';
import { storyFeature } from './storybook.fixtures';

export type MapDataState =
  | 'loaded'
  | 'empty'
  | 'partial'
  | 'error'
  | 'rate-limited';
export type MapAreaState = 'none' | 'radius' | 'controls' | 'drawing' | 'error';

export interface MapStoryArgs {
  mode: MapDisplayMode;
  dataState: MapDataState;
  areaState: MapAreaState;
  categories: string[];
  afterDate: string | null;
  beforeDate: string | null;
  period: string | null;
  hourFilterEnabled: boolean;
  startHour: number;
  endHour: number;
  datasetRevision: string;
  longitude: number;
  latitude: number;
  radius: number;
  vehicleBrands: string[];
  objectTypes: string[];
  locationTypes: string[];
}

class StoryMapSetupService {
  setupMap(document: Document): OlMap {
    void document;
    const rasterLayer = new ImageLayer({
      source: new ImageCanvasSource({
        projection: 'EPSG:3857',
        canvasFunction: (_extent, _resolution, pixelRatio, size) =>
          createStoryMapCanvas(size, pixelRatio),
      }),
    });
    return new OlMap({
      target: 'ol-map-tab',
      layers: [rasterLayer],
      view: new View({
        center: fromLonLat([-46.63331, -23.55052]),
        zoom: 16,
        maxZoom: 19,
        projection: 'EPSG:3857',
      }),
    });
  }

  disposeMapState(map: OlMap): void {
    void map;
  }
}

function createStoryMapCanvas(
  size: number[],
  pixelRatio: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size[0] * pixelRatio);
  canvas.height = Math.round(size[1] * pixelRatio);
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = '#eeece7';
  context.fillRect(0, 0, size[0], size[1]);
  context.fillStyle = '#daebdb';
  for (let y = 16; y < size[1]; y += 192) {
    for (let x = 24; x < size[0]; x += 224) {
      context.fillRect(x, y, 96, 76);
    }
  }
  context.strokeStyle = '#ffffff';
  context.lineWidth = 5;
  for (let x = 0; x < size[0]; x += 96) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + size[1] * 0.16, size[1]);
    context.stroke();
  }
  for (let y = 0; y < size[1]; y += 72) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size[0], y + size[0] * 0.05);
    context.stroke();
  }
  context.strokeStyle = '#d3d6da';
  context.lineWidth = 1;
  for (let y = 36; y < size[1]; y += 36) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size[0], y);
    context.stroke();
  }
  return canvas;
}

@Component({
  selector: 'app-map-story-harness',
  imports: [MapComponent],
  providers: [
    MapMarkersService,
    { provide: CensusService, useClass: StoryCensusService },
    {
      provide: VectorTileMapSetupService,
      useClass: StoryMapSetupService,
    },
  ],
  template: `
    <div class="story-map" [class.story-map--embedded]="embedded()">
      <app-map
        [addressCenter]="{ lon: longitude(), lat: latitude() }"
        [dateFilters]="{ after: afterDate(), before: beforeDate() }"
        [detailFilters]="{
          vehicleBrands: vehicleBrands(),
          objectTypes: objectTypes(),
          locationTypes: locationTypes()
        }"
        [datasetRevision]="datasetRevision()"
        [periodFilter]="period()"
        [hourFilter]="{
          enabled: hourFilterEnabled(),
          startHour: startHour(),
          endHour: endHour()
        }"
        [rubricasFormValues]="productionCategories"
        [showIndeterminateProgressBar]="showIndeterminateProgressBar"
        [progressBarPercentage]="progressBarPercentage"
        (areaChange)="areaChange.emit($event)"
      />
    </div>
  `,
  styles: `
    :host,
    .story-map {
      display: block;
      height: 100vh;
      min-height: 40rem;
      position: relative;
      width: 100%;
    }

    :host:has(.story-map--embedded),
    .story-map--embedded {
      height: 100%;
      min-height: 0;
    }

    app-map {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.75rem;
      display: block;
      height: 100%;
      min-height: inherit;
      overflow: hidden;
    }

  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapStoryHarnessComponent implements OnDestroy {
  private readonly dialog = inject(MatDialog);
  private readonly occurrencesService = inject(OccurrencesService);
  readonly mode = input<MapDisplayMode>('auto');
  readonly dataState = input<MapDataState>('loaded');
  readonly areaState = input<MapAreaState>('none');
  readonly categories = input<string[]>([
    'Furto',
    'Roubo',
    'Estelionato',
    'Veículos recuperados',
  ]);
  readonly afterDate = input<string | null>('2026-01-01');
  readonly beforeDate = input<string | null>('2026-08-31');
  readonly period = input<string | null>(null);
  readonly hourFilterEnabled = input(false);
  readonly startHour = input(8);
  readonly endHour = input(19);
  readonly datasetRevision = input('storybook-2026-09-12');
  readonly longitude = input(-46.63331);
  readonly latitude = input(-23.55052);
  readonly radius = input(750);
  readonly vehicleBrands = input<string[]>([]);
  readonly objectTypes = input<string[]>([]);
  readonly locationTypes = input<string[]>([]);
  readonly embedded = input(false);
  readonly areaChange = output<AnalysisArea | null>();

  readonly mapComponent = viewChild(MapComponent);
  readonly showIndeterminateProgressBar = signal(false);
  readonly progressBarPercentage = signal(-1);
  readonly productionCategories: Record<string, boolean> = {};

  private fakeLayer: BaseLayer | null = null;
  private readonly storyReady = signal(false);
  private readonly markersService = new MapMarkersService();

  private readonly synchronizeMode = effect(() => {
    const ready = this.storyReady();
    const component = this.mapComponent();
    const mode = this.mode();
    if (!ready || !component?.olMap) return;
    untracked(() => component.setDisplayMode(mode));
  });

  private readonly synchronizeStatus = effect(() => {
    const ready = this.storyReady();
    const component = this.mapComponent();
    const state = this.dataState();
    if (!ready || !component?.olMap) return;
    this.applyStatus(component, state);
  });

  private readonly synchronizeArea = effect(() => {
    const ready = this.storyReady();
    const component = this.mapComponent();
    const area = this.areaState();
    const longitude = this.longitude();
    const latitude = this.latitude();
    const radius = this.radius();
    if (!ready || !component?.olMap) return;
    this.applyAreaState(component, area, longitude, latitude, radius);
  });

  private readonly synchronizeData = effect(() => {
    const ready = this.storyReady();
    const component = this.mapComponent();
    const state = this.dataState();
    const categories = this.categories();
    if (!ready || !component?.olMap) return;
    component.activeCategories.set(categories);
    this.renderFakeData(
      component.olMap,
      component.displayMode(),
      state,
      categories
    );
  });

  constructor() {
    this.occurrencesService.getFullFeature = () => of(storyFeature);
    afterNextRender(() => this.storyReady.set(true));
  }

  ngOnDestroy(): void {
    this.removeFakeLayer();
  }

  private applyStatus(component: MapComponent, state: MapDataState): void {
    component.tileCompleteness.set(state === 'partial');
    component.tileError.set(
      state === 'error'
        ? 'Não foi possível carregar uma parte do mapa. Tente novamente.'
        : state === 'rate-limited'
        ? 'O servidor limitou o carregamento de uma parte do mapa. Tente novamente.'
        : null
    );
  }

  private applyAreaState(
    component: MapComponent,
    state: MapAreaState,
    longitude: number,
    latitude: number,
    radiusInMeters: number
  ): void {
    const radius: AnalysisArea = {
      longitude,
      latitude,
      radius: radiusInMeters,
    };

    component.selectedArea.set(state === 'radius' ? radius : null);
    component.areaControlsOpen.set(
      state === 'controls' || state === 'drawing' || state === 'error'
    );
    component.drawing.set(state === 'drawing');
    component.areaError.set(
      state === 'error'
        ? 'Área inválida ou muito extensa. Use até 100 pontos, sem cruzar linhas, em um recorte de até 10.000 km² e 200 km de extensão.'
        : null
    );
  }

  private renderFakeData(
    map: OlMap,
    mode: MapDisplayMode,
    state: MapDataState,
    categories: string[]
  ): void {
    this.removeFakeLayer();
    map.updateSize();

    if (state === 'empty' || categories.length === 0) {
      map.renderSync();
      return;
    }

    if (mode === 'heatmap') {
      const features = storyMapFeatures
        .filter((feature) => categories.includes(feature.category))
        .map((feature) => this.createPoint(feature));
      this.fakeLayer = createOccurrenceHeatmap(new VectorSource({ features }));
    } else if (mode === 'density') {
      const densityCounts = [3, 18, 75, 320, 1_400];
      const center = fromLonLat([-46.63331, -23.55052]);
      const densityFeatures = densityCounts.map((count, index) => {
        const column = index - 2;
        const circle = new CircleGeometry(
          [center[0] + column * 330, center[1]],
          185
        );
        const geometry = fromCircle(circle, 6);
        geometry.rotate(Math.PI / 6, circle.getCenter());
        return new Feature<Polygon>({
          geometry,
          occurrence_count: count,
          cell_id: `storybook-density-${index}`,
        });
      });
      this.fakeLayer = new VectorLayer({
        source: new VectorSource({ features: densityFeatures }),
        style: createDensityStyleFunction(),
        zIndex: 20,
      });
    } else {
      const selected = storyMapFeatures.filter((feature) =>
        categories.includes(feature.category)
      );
      const features = selected.map((feature) => this.createPoint(feature));

      if (mode === 'auto') {
        this.fakeLayer = new VectorLayer({
          source: new ClusterSource({
            source: new VectorSource({ features }),
            distance: 54,
            minDistance: 30,
          }),
          style: createClusterStyleFunction(categories, (category) =>
            this.markersService.markerChooser(category)
          ),
          zIndex: 20,
        });
      } else {
        this.fakeLayer = new VectorLayer({
          source: new VectorSource({ features }),
          style: createOccurrenceStyleFunction(categories, (category) =>
            this.markersService.markerChooser(category)
          ),
          zIndex: 20,
        });
      }
      this.fakeLayer.set(MAP_INTERACTIVE_LAYER_PROPERTY, true);
      map.on('singleclick', (event) => {
        const clicked = map.forEachFeatureAtPixel(
          event.pixel,
          (feature) => feature,
          { layerFilter: (layer) => layer === this.fakeLayer, hitTolerance: 6 }
        );
        const feature = clicked?.get('features')?.[0] ?? clicked;
        const featureId = feature?.get('feature_id') as string | undefined;
        if (!featureId) return;
        void import(
          '../components/map/components/feature-detail-dialog/feature-detail-dialog.component'
        ).then(({ FeatureDetailDialogComponent }) => {
          this.dialog.open(FeatureDetailDialogComponent, {
            data: {
              featureId,
              numBo: feature.get('num_bo'),
              anoBo: feature.get('ano_bo'),
            },
            width: '700px',
            maxWidth: '90vw',
            maxHeight: '90vh',
          });
        });
      });
    }

    map.addLayer(this.fakeLayer);
    map.renderSync();
  }

  private createPoint(feature: StoryMapFeature): Feature<Point> {
    return new Feature<Point>({
      geometry: new Point(fromLonLat(feature.coordinates)),
      feature_id: feature.featureId,
      num_bo: feature.numBo,
      ano_bo: feature.anoBo,
      delegacia: feature.delegacia,
      category: feature.category,
      server_singleton: 1,
    });
  }

  private removeFakeLayer(): void {
    const map = this.mapComponent()?.olMap;
    if (!map || !this.fakeLayer) return;

    map.removeLayer(this.fakeLayer);
    this.fakeLayer.dispose();
    this.fakeLayer = null;
  }
}
