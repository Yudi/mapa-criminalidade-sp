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

    expect(url).toContain('categories=Furto%2CRoubo');
    expect(url).toContain(`periods=${encodeURIComponent('À noite,À tarde')}`);
  });

  it('versions the vector tile payload contract to avoid stale tile shapes', () => {
    expect(service.buildTileUrl()).toContain('tileSchema=v1');
  });
});
