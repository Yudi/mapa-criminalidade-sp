import { buildDisplayTileQuery } from './map-features-display-tile-query';
import { MapFeaturesVectorTileQuery } from './map-features-vector-tile-query';
import { PrismaService } from '../../../prisma/prisma.service';

describe('display tile queries', () => {
  it('uses fixed full hexagons and assigns border points only once before tile clipping', () => {
    const query = buildDisplayTileQuery({
      z: 12,
      x: 100,
      y: 200,
      mode: 'density',
      categories: ["Furto, D'Ávila"],
      startHour: 22,
      endHour: 4,
    });
    expect(query.sql).toContain(
      'ST_HexagonGrid(500, ST_Expand(envelope, 1000))'
    );
    expect(query.sql).toContain('SELECT DISTINCT ON (id) id, i, j');
    expect(query.sql).toContain(
      'ST_Covers(cell_geom, ST_Transform(geom, 3857))'
    );
    expect(query.sql).toContain(
      'COUNT(*) AS occurrence_count FROM assigned GROUP BY i, j'
    );
    expect(query.sql).not.toContain('LIMIT');
    expect(query.sql).not.toContain("D'Ávila");
    expect(query.values).toEqual([12, 100, 200, "Furto, D'Ávila", 22, 4]);
    const zoomed = buildDisplayTileQuery({
      z: 16,
      x: 1600,
      y: 3200,
      mode: 'density',
      categories: ["Furto, D'Ávila"],
      startHour: 22,
      endHour: 4,
    });
    expect(zoomed.sql).toBe(query.sql);
  });

  it('retains date and detail predicates and reports incomplete individual-marker tiles', () => {
    const query = buildDisplayTileQuery({
      z: 12,
      x: 100,
      y: 200,
      mode: 'markers',
      afterDate: '2026-01-01',
      categories: ['Furto'],
      objectTypes: ['Celular'],
    });
    expect(query.sql).toContain('data_ocorrencia >= $4');
    expect(query.sql).toContain(
      'public.map_feature_matches_details(feature_data, $6::jsonb)'
    );
    expect(query.sql).toContain('jsonb_array_elements_text($7::jsonb)');
    expect(query.sql).toContain('ORDER BY id LIMIT 50000');
    expect(query.sql).toContain(
      'CASE WHEN tile_total > 50000 THEN 1 END AS truncated'
    );
    expect(query.values).toEqual([
      12,
      100,
      200,
      '2026-01-01',
      'Furto',
      JSON.stringify({ objectTypes: ['Celular'] }),
      '["Furto"]',
    ]);
  });

  it('uses the existing cancellation and concurrency path for density queries', async () => {
    const executeCancelableReadOnlyQuery = jest
      .fn()
      .mockResolvedValue([{ mvt: Buffer.from([1]) }]);
    const query = new MapFeaturesVectorTileQuery({
      executeCancelableReadOnlyQuery,
    } as unknown as PrismaService);
    const controller = new AbortController();
    expect(
      await query.getTile(
        { z: 12, x: 100, y: 200, mode: 'density' },
        controller.signal
      )
    ).toEqual({ status: 'ok', tile: Buffer.from([1]) });
    expect(executeCancelableReadOnlyQuery).toHaveBeenCalledWith(
      expect.stringContaining('ST_HexagonGrid'),
      [12, 100, 200],
      controller.signal
    );
  });
});
