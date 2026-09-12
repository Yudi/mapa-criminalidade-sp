import { MapFeaturesResolver } from './map-features.resolver';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { ValidatorsService } from '../shared/validators/validators.service';

const bounds = { minLon: -46.7, maxLon: -46.6, minLat: -23.6, maxLat: -23.5 };
describe('temporal query validation', () => {
  const getTemporalStats = jest
    .fn()
    .mockResolvedValue({ total: 0, monthly: [], categories: [] });
  const resolver = new MapFeaturesResolver(
    { getTemporalStats } as unknown as MapFeaturesQueryService,
    {} as MapFeaturesMapperService,
    new ValidatorsService()
  );
  beforeEach(() => getTemporalStats.mockClear());

  it('requires a fixed geographic scope and inclusive dates', async () => {
    for (const filter of [
      {},
      { bounds },
      { afterDate: '2024-01-01', beforeDate: '2024-12-31' },
    ]) {
      await expect(resolver.getTemporalStats(filter)).rejects.toThrow(
        'requires an area'
      );
    }
    expect(getTemporalStats).not.toHaveBeenCalled();
  });
  it('rejects more than 120 calendar months before executing SQL', async () => {
    await expect(
      resolver.getTemporalStats({
        bounds,
        afterDate: '2014-01-01',
        beforeDate: '2024-01-01',
      })
    ).rejects.toThrow('120 months');
    expect(getTemporalStats).not.toHaveBeenCalled();
  });
  it('uses common validation for impossible and reversed dates', async () => {
    await expect(
      resolver.getTemporalStats({
        bounds,
        afterDate: '2024-02-30',
        beforeDate: '2024-03-01',
      })
    ).rejects.toThrow();
    await expect(
      resolver.getTemporalStats({
        bounds,
        afterDate: '2024-03-01',
        beforeDate: '2024-02-01',
      })
    ).rejects.toThrow();
    expect(getTemporalStats).not.toHaveBeenCalled();
  });
  it('normalizes the same spatial, category and hour filters as the map', async () => {
    await resolver.getTemporalStats({
      bounds,
      afterDate: '2015-01-01',
      beforeDate: '2024-12-31',
      categories: [' Furto '],
      startHour: 22,
      endHour: 4,
    });
    expect(getTemporalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        ...bounds,
        categories: ['Furto'],
        startHour: 22,
        endHour: 4,
      })
    );
  });
});
