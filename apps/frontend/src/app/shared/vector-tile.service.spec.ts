import { TestBed } from '@angular/core/testing';
import { GraphqlClientService } from './graphql-client.service';
import { VectorTileService } from './vector-tile.service';

describe('VectorTileService', () => {
  let service: VectorTileService;

  it('uses the same filtered raw point tiles for smooth heatmaps and individual markers', () => {
    const filters = {
      categories: ['Furto'],
      weekdays: [2],
      startHour: 22,
      endHour: 4,
      datasetRevision: '7',
    };
    expect(service.buildTileUrl({ ...filters, mode: 'heatmap' })).toBe(
      service.buildTileUrl({ ...filters, mode: 'markers' })
    );
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        VectorTileService,
        {
          provide: GraphqlClientService,
          useValue: { request: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(VectorTileService);
  });

  it('canonicalizes list filters to improve tile cache reuse', () => {
    const url = service.buildTileUrl({
      categories: [' Roubo ', 'Furto', 'Roubo'],
      periods: ['À noite', 'À tarde'],
    });

    expect(url).toContain(
      `categories=${encodeURIComponent(JSON.stringify(['Furto', 'Roubo']))}`
    );
    expect(url).toContain(
      `periods=${encodeURIComponent(JSON.stringify(['À noite', 'À tarde']))}`
    );
  });

  it('preserves commas and accents inside length-delimited filter values', () => {
    const url = service.buildTileUrl({
      categories: ['Roubo, furto e perda', 'Agressão'],
      periods: ['Noite, madrugada'],
    });
    const parsed = new URL(url, 'http://localhost');

    expect(JSON.parse(parsed.searchParams.get('categories') ?? '[]')).toEqual([
      'Agressão',
      'Roubo, furto e perda',
    ]);
    expect(JSON.parse(parsed.searchParams.get('periods') ?? '[]')).toEqual([
      'Noite, madrugada',
    ]);
  });

  it('preserves detail values and changes the tile identity when filters are removed', () => {
    const filters = {
      vehicleBrands: [' VW/Audi, importado ', 'VW/Audi, importado'],
      objectTypes: ['Celular'],
      phoneBrandModels: ['Samsung · Galaxy'],
      locationTypes: ['Via pública'],
      weekdays: [7, 1, 7],
    };
    const url = new URL(service.buildTileUrl(filters));
    expect(JSON.parse(url.searchParams.get('vehicleBrands') ?? '[]')).toEqual([
      'VW/Audi, importado',
    ]);
    expect(JSON.parse(url.searchParams.get('objectTypes') ?? '[]')).toEqual([
      'Celular',
    ]);
    expect(
      JSON.parse(url.searchParams.get('phoneBrandModels') ?? '[]')
    ).toEqual(['Samsung · Galaxy']);
    expect(JSON.parse(url.searchParams.get('locationTypes') ?? '[]')).toEqual([
      'Via pública',
    ]);
    expect(JSON.parse(url.searchParams.get('weekdays') ?? '[]')).toEqual([
      1, 7,
    ]);
    expect(
      service.buildTileUrl({ ...filters, vehicleBrands: undefined })
    ).not.toBe(url.href);
  });

  it('versions the vector tile payload contract to avoid stale tile shapes', () => {
    expect(service.buildTileUrl()).toContain('tileSchema=v3');
  });

  it('includes the published dataset revision in tile cache identity', () => {
    const url = new URL(
      service.buildTileUrl({ datasetRevision: 'revision/b' }),
      'http://localhost'
    );

    expect(url.searchParams.get('datasetRevision')).toBe('revision/b');
  });

  it('routes new display modes to the backend while preserving the original tile server', () => {
    const original = service.buildTileUrl();
    expect(service.buildTileUrl({ mode: 'auto' })).toBe(original);
    for (const mode of ['markers', 'density'] as const) {
      const url = new URL(
        service.buildTileUrl({
          mode,
          categories: ['Furto'],
          startHour: 22,
          endHour: 4,
          datasetRevision: '7',
        })
      );
      expect(url.pathname).toContain('/api/tiles/');
      expect(url.pathname).toContain('.mvt');
      expect(url.searchParams.get('mode')).toBe(mode);
      expect(url.searchParams.get('startHour')).toBe('22');
      expect(url.searchParams.get('endHour')).toBe('4');
      expect(url.searchParams.get('datasetRevision')).toBe('7');
      expect(url.href).not.toBe(original);
    }
  });
});
