import { TestBed } from '@angular/core/testing';
import { GraphqlClientService } from './graphql-client.service';
import { VectorTileService } from './vector-tile.service';

describe('VectorTileService', () => {
  let service: VectorTileService;

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

  it('versions the vector tile payload contract to avoid stale tile shapes', () => {
    expect(service.buildTileUrl()).toContain('tileSchema=v2');
  });
});
