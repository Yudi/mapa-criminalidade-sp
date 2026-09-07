import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorSource from 'ol/source/Vector';
import CircleStyle from 'ol/style/Circle';
import Icon from 'ol/style/Icon';
import Style from 'ol/style/Style';

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapComponent],
      providers: [
        {
          provide: VectorTileMapSetupService,
          useValue: {
            setupMap: vi.fn(() => null),
          },
        },
      ],
    })
    .compileComponents();

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
    fixture.componentRef.setInput('showIndeterminateProgressBar', signal(false));
    fixture.componentRef.setInput('progressBarPercentage', signal(-1));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the tile and client cluster layers eligible at their handoff zooms', () => {
    expect(TILE_LAYER_MIN_ZOOM).toBeLessThan(10);
    expect(TILE_LAYER_MIN_ZOOM).toBeGreaterThan(9.99);
    expect(CLIENT_CLUSTER_LAYER_MIN_ZOOM).toBe(15);
  });

  it('renders clickable low-zoom singletons as icons', () => {
    const style = createOccurrenceStyleFunction(['Roubo'], () => '/marker.png')(
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

  it('renders dense low-zoom aggregates as clusters', () => {
    const style = createOccurrenceStyleFunction(['Roubo'], () => '/marker.png')(
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
    const style = createOccurrenceStyleFunction(['Roubo', 'Furto'], () => '/marker.png')(
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
});
