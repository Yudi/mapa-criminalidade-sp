import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import Draw, { DrawEvent } from 'ol/interaction/Draw';
import OlMap from 'ol/Map';
import View from 'ol/View';
import VectorTileLayer from 'ol/layer/VectorTile';
import Heatmap from 'ol/layer/Heatmap';
import { MAP_INTERACTIVE_LAYER_PROPERTY } from './utils/map-layer.constants';
import VectorSource from 'ol/source/Vector';
import CircleStyle from 'ol/style/Circle';
import Icon from 'ol/style/Icon';
import Style from 'ol/style/Style';
import { MapMarkersService } from '../../shared/map-markers.service';

import {
  CLIENT_CLUSTER_LAYER_MIN_ZOOM,
  MapComponent,
  TILE_LAYER_MIN_ZOOM,
} from './map.component';
import { VectorTileMapSetupService } from './services/vector-tile-map-setup.service';
import {
  createClusterStyleFunction,
  createOccurrenceStyleFunction,
} from './utils/map-style.utils';

describe('MapComponent', () => {
  let component: MapComponent;
  let fixture: ComponentFixture<MapComponent>;

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [
        {
          provide: VectorTileMapSetupService,
          useValue: {
            setupMap: vi.fn(() => null),
            disposeMapState: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('addressCenter', { lon: null, lat: null });
    fixture.componentRef.setInput('dateFilters', { before: null, after: null });
    fixture.componentRef.setInput('periodFilter', null);
    fixture.componentRef.setInput('hourFilter', {
      enabled: false,
      startHour: 0,
      endHour: 23,
    });
    fixture.componentRef.setInput('rubricasFormValues', undefined);
    fixture.componentRef.setInput(
      'showIndeterminateProgressBar',
      signal(false)
    );
    fixture.componentRef.setInput('progressBarPercentage', signal(-1));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('switches from density to individual markers and restores the original cluster layer', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    component.olMap = new OlMap({
      view: new View({ center: [0, 0], zoom: 16 }),
    });
    fixture.componentRef.setInput('rubricasFormValues', { Furto: true });
    fixture.detectChanges();
    component.setDisplayMode('density');
    const layers = component.olMap.getLayers();
    expect(layers.getLength()).toBe(1);
    const tiles = layers.item(0) as VectorTileLayer;
    expect(tiles.get(MAP_INTERACTIVE_LAYER_PROPERTY)).toBe(false);
    expect(tiles.getSource()?.getUrls()?.[0]).toContain('mode=density');
    const canvas = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        createLinearGradient: () => ({ addColorStop: vi.fn() }),
        fillRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
    try {
      component.setDisplayMode('heatmap');
    } finally {
      canvas.mockRestore();
    }
    expect(layers.getLength()).toBe(2);
    const heatmap = layers.item(1) as Heatmap;
    expect(heatmap).toBeInstanceOf(Heatmap);
    expect(heatmap.getGradient()).toEqual([
      '#0000ff',
      '#00ffff',
      '#00ff00',
      '#ffff00',
      '#ff0000',
    ]);
    expect(tiles.get(MAP_INTERACTIVE_LAYER_PROPERTY)).toBe(false);
    expect(tiles.getSource()?.getUrls()?.[0]).toContain('mode=markers');
    const dispose = vi.spyOn(heatmap, 'dispose');
    component.setDisplayMode('markers');
    expect(dispose).toHaveBeenCalledOnce();
    expect(layers.getLength()).toBe(1);
    expect(tiles.get(MAP_INTERACTIVE_LAYER_PROPERTY)).toBe(true);
    expect(tiles.getSource()?.getUrls()?.[0]).toContain('mode=markers');
    component.setDisplayMode('auto');
    expect(layers.getLength()).toBe(2);
    expect(tiles.getSource()?.getUrls()?.[0]).not.toContain('mode=');
    expect(
      TestBed.inject(VectorTileMapSetupService).disposeMapState
    ).toHaveBeenCalledTimes(4);
  });

  it('keeps the tile and client cluster layers eligible at their handoff zooms', () => {
    expect(TILE_LAYER_MIN_ZOOM).toBeLessThan(10);
    expect(TILE_LAYER_MIN_ZOOM).toBeGreaterThan(9.99);
    expect(CLIENT_CLUSTER_LAYER_MIN_ZOOM).toBe(15);
  });

  it('renders clickable low-zoom singletons as icons', () => {
    const style = createOccurrenceStyleFunction(
      ['Roubo'],
      () => '/marker.png'
    )(
      new Feature({
        category: 'Roubo',
        server_singleton: 1,
        num_bo: '123',
        ano_bo: 2024,
      })
    ) as Style;

    expect(style.getImage()).toBeInstanceOf(Icon);
    expect(style.getText()).toBeNull();
  });

  it('uses the source rubrica to resolve a derived category marker', () => {
    const markersService = new MapMarkersService();
    const markerChooser = vi.fn((rubrica: string) =>
      markersService.markerChooser(rubrica)
    );
    const style = createOccurrenceStyleFunction(
      ['Flagrantes Lavrados'],
      markerChooser
    )(
      new Feature({
        category: 'Flagrantes Lavrados',
        rubrica_for_styling: 'PRISÃO EM FLAGRANTE',
        server_singleton: 1,
      })
    ) as Style;

    expect(markerChooser).toHaveBeenCalledWith('PRISÃO EM FLAGRANTE');
    expect((style.getImage() as Icon).getSrc()).toBe('markers/prisao.png');
  });

  it('renders dense low-zoom aggregates as clusters', () => {
    const style = createOccurrenceStyleFunction(
      ['Roubo'],
      () => '/marker.png'
    )(
      new Feature({
        category: 'Roubo',
        cluster_count: 42,
        server_cluster: 1,
      })
    ) as Style;

    expect(style.getImage()).toBeInstanceOf(CircleStyle);
    expect(style.getText()?.getText()).toBe('42');
  });

  it('renders mixed-category server clusters before singleton category filtering', () => {
    const style = createOccurrenceStyleFunction(
      ['Roubo', 'Furto'],
      () => '/marker.png'
    )(
      new Feature({
        category: 'Múltiplas categorias',
        cluster_count: 3,
        server_cluster: 1,
      })
    ) as Style;

    expect(style.getImage()).toBeInstanceOf(CircleStyle);
    expect(style.getText()?.getText()).toBe('3');
  });

  it('clusters high-zoom raw features but keeps a solo feature as an icon', () => {
    const first = new Feature({
      geometry: new Point([1, 2]),
      category: 'Roubo',
    });
    const second = new Feature({
      geometry: new Point([2, 3]),
      category: 'Roubo',
    });
    const styleFunction = createClusterStyleFunction(
      ['Roubo'],
      () => '/marker.png'
    );

    expect(
      (styleFunction(new Feature({ features: [first] })) as Style).getImage()
    ).toBeInstanceOf(Icon);
    expect(
      (styleFunction(new Feature({ features: [first, second] })) as Style)
        .getText()
        ?.getText()
    ).toBe('2');
  });

  it('copies only high-zoom raw points into the client cluster source', () => {
    const source = new VectorSource<Feature<Point>>();
    const rawFeature = new Feature({
      geometry: new Point([1, 2]),
      category: 'Roubo',
      rubrica_for_styling: 'Roubo (art. 157)',
      feature_id: 'feature-1',
      num_bo: '123',
      ano_bo: 2024,
    });
    const serverSingleton = new Feature({
      geometry: new Point([3, 4]),
      category: 'Roubo',
      feature_id: 'feature-2',
      server_singleton: 1,
    });
    const testableComponent = component as unknown as {
      clusterFeatureSource: VectorSource<Feature<Point>>;
      addClusterFeatures(
        features: Feature[],
        categories: ReadonlySet<string>
      ): void;
    };
    testableComponent.clusterFeatureSource = source;
    const addFeaturesSpy = vi.spyOn(source, 'addFeatures');
    const addFeatureSpy = vi.spyOn(source, 'addFeature');

    testableComponent.addClusterFeatures(
      [rawFeature, serverSingleton],
      new Set(['Roubo'])
    );

    expect(source.getFeatures()).toHaveLength(1);
    expect(source.getFeatures()[0].get('num_bo')).toBe('123');
    expect(source.getFeatures()[0].get('rubrica_for_styling')).toBe(
      'Roubo (art. 157)'
    );
    expect(addFeaturesSpy).toHaveBeenCalledTimes(1);
    expect(addFeatureSpy).not.toHaveBeenCalled();
  });

  it('debounces consecutive tile-layer refreshes', () => {
    vi.useFakeTimers();
    const testableComponent = component as unknown as {
      olMap: object | null;
      scheduleTileLayerUpdate(): void;
      updateTileLayer(): void;
    };
    testableComponent.olMap = {};
    const updateSpy = vi
      .spyOn(testableComponent, 'updateTileLayer')
      .mockImplementation(() => undefined);

    testableComponent.scheduleTileLayerUpdate();
    testableComponent.scheduleTileLayerUpdate();
    testableComponent.scheduleTileLayerUpdate();
    vi.advanceTimersByTime(199);

    expect(updateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    updateSpy.mockRestore();
    testableComponent.olMap = null;
    vi.useRealTimers();
  });
  it('selects a geodesic radius at the searched address and clears it', () => {
    const fit = vi.fn();
    component.olMap = {
      getView: () => ({ getProjection: () => 'EPSG:3857', fit }),
    } as unknown as OlMap;
    fixture.componentRef.setInput('addressCenter', { lon: -46.6, lat: -23.5 });
    const emit = vi.spyOn(component.areaChange, 'emit');
    component.radiusControl.setValue(1000);
    component.selectRadius();
    expect(emit).toHaveBeenLastCalledWith({
      longitude: -46.6,
      latitude: -23.5,
      radius: 1000,
    });
    expect(fit).toHaveBeenCalled();
    component.clearArea();
    expect(emit).toHaveBeenLastCalledWith(null);
    expect(component.selectedArea()).toBeNull();
    component.olMap = null;
  });

  it('accepts a valid completed polygon, retains selection on cancel, and rejects crossed lines', () => {
    let draw: Draw | undefined;
    const removeInteraction = vi.fn();
    component.olMap = {
      getView: () => ({ getProjection: () => 'EPSG:4326' }),
      addInteraction: (interaction: Draw) => {
        draw = interaction;
      },
      removeInteraction,
    } as unknown as OlMap;
    const emit = vi.spyOn(component.areaChange, 'emit');
    component.startDrawing();
    draw?.dispatchEvent(
      new DrawEvent(
        'drawend',
        new Feature(
          new Polygon([
            [
              [-46.65, -23.56],
              [-46.63, -23.56],
              [-46.63, -23.54],
              [-46.65, -23.56],
            ],
          ])
        )
      )
    );
    expect(emit).toHaveBeenCalledTimes(1);
    const area = component.selectedArea();
    expect(area?.polygon).toContain('Polygon');
    expect(component.drawing()).toBe(false);
    component.startDrawing();
    component.cancelDrawing();
    expect(component.selectedArea()).toEqual(area);
    component.startDrawing();
    draw?.dispatchEvent(
      new DrawEvent(
        'drawend',
        new Feature(
          new Polygon([
            [
              [0, 0],
              [0.01, 0.01],
              [0, 0.01],
              [0.01, 0],
              [0, 0],
            ],
          ])
        )
      )
    );
    expect(emit).toHaveBeenCalledTimes(1);
    expect(component.areaError()).toBeTruthy();
    expect(component.selectedArea()).toEqual(area);
    expect(removeInteraction).toHaveBeenCalledTimes(3);
    component.olMap = null;
  });
});
