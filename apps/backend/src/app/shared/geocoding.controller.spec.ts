import axios from 'axios';
import { GeocodingController } from './geocoding.controller';

describe('GeocodingController', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shares provider admission and cached results across callers', async () => {
    const get = jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: [{ lat: '-23.5', lon: '-46.6' }] });
    const controller = new GeocodingController();
    const first = controller.search('Paulista', 'São Paulo', 'SP');
    const duplicate = controller.search('Paulista', 'São Paulo', 'SP');
    await expect(
      controller.search('Augusta', 'São Paulo', 'SP')
    ).rejects.toMatchObject({ status: 429 });
    expect(await first).toEqual(await duplicate);
    await controller.search('Paulista', 'São Paulo', 'SP');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 10_000, maxContentLength: 262_144 })
    );
  });

  it('does not call the provider for repeated or missing scalar parameters', async () => {
    const get = jest.spyOn(axios, 'get');
    const controller = new GeocodingController();
    await expect(
      controller.search(['A', 'B'], 'São Paulo', 'SP')
    ).rejects.toMatchObject({ status: 400 });
    expect(get).not.toHaveBeenCalled();
  });

  it('releases admission after provider failure without caching an empty success', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(0);
    const get = jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: [] });
    const controller = new GeocodingController();
    await expect(controller.search('A', 'B', 'SP')).rejects.toMatchObject({
      status: 503,
    });
    jest.spyOn(Date, 'now').mockReturnValue(1_001);
    await expect(controller.search('A', 'B', 'SP')).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
