import type { Request } from 'express';
import axios from 'axios';
import { GeocodingController } from './geocoding.controller';

const requestFrom = (ip: string, forwardedFor?: string): Request =>
  ({
    ip,
    headers: { 'x-forwarded-for': forwardedFor },
  }) as unknown as Request;

describe('GeocodingController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('coalesces requests, caches results, and limits each client to 10 per minute', async () => {
    const get = jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: [{ lat: '-23.5', lon: '-46.6' }] });
    const controller = new GeocodingController();
    const requests = Array.from({ length: 10 }, (_, index) =>
      controller.search(
        'Paulista',
        'São Paulo',
        'SP',
        requestFrom('192.0.2.1', `198.51.100.${index + 1}`)
      )
    );

    await expect(
      controller.search(
        'Paulista',
        'São Paulo',
        'SP',
        requestFrom('192.0.2.1', '198.51.100.11')
      )
    ).rejects.toMatchObject({ status: 429 });
    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 10 }, () => [{ lat: '-23.5', lon: '-46.6' }])
    );
    await expect(
      controller.search(
        'Paulista',
        'São Paulo',
        'SP',
        requestFrom('192.0.2.2')
      )
    ).resolves.toEqual([{ lat: '-23.5', lon: '-46.6' }]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 10_000, maxContentLength: 262_144 })
    );
  });

  it('round-robins clients and starts provider requests at least one second apart', async () => {
    jest.useFakeTimers().setSystemTime(0);
    const starts: { street: unknown; at: number }[] = [];
    const get = jest.spyOn(axios, 'get').mockImplementation((_, options) => {
      const params = options?.params as { street?: unknown } | undefined;
      starts.push({
        street: params?.street,
        at: Date.now(),
      });
      return Promise.resolve({
        data: [{ lat: '-23.5', lon: '-46.6' }],
      }) as never;
    });
    const controller = new GeocodingController();
    const attacker = requestFrom('192.0.2.10');
    const neighbor = requestFrom('192.0.2.20');
    const attackerActive = controller.search(
      'attacker-active',
      'São Paulo',
      'SP',
      attacker
    );
    const attackerFirstQueued = controller.search(
      'attacker-first-queued',
      'São Paulo',
      'SP',
      attacker
    );
    const attackerSecondQueued = controller.search(
      'attacker-second-queued',
      'São Paulo',
      'SP',
      attacker
    );
    const neighborQueued = controller.search(
      'neighbor',
      'São Paulo',
      'SP',
      neighbor
    );

    await expect(attackerActive).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(attackerFirstQueued).resolves.toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(neighborQueued).resolves.toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(attackerSecondQueued).resolves.toHaveLength(1);

    expect(starts.map(({ street }) => street)).toEqual([
      'attacker-active',
      'attacker-first-queued',
      'neighbor',
      'attacker-second-queued',
    ]);
    expect(starts.map(({ at }) => at)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('bounds queued work per client while allowing other clients to queue', async () => {
    jest.useFakeTimers().setSystemTime(0);
    let completeFirst!: (response: { data: never[] }) => void;
    const get = jest
      .spyOn(axios, 'get')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeFirst = resolve;
          })
      )
      .mockResolvedValue({ data: [] });
    const controller = new GeocodingController();
    const attacker = requestFrom('192.0.2.30');
    const active = controller.search('active', 'São Paulo', 'SP', attacker);
    const queued = Array.from({ length: 5 }, (_, index) =>
      controller.search(`queued-${index}`, 'São Paulo', 'SP', attacker)
    );

    await expect(
      controller.search('overflow', 'São Paulo', 'SP', attacker)
    ).rejects.toMatchObject({ status: 429 });
    const otherClient = controller.search(
      'other-client',
      'São Paulo',
      'SP',
      requestFrom('192.0.2.40')
    );

    completeFirst({ data: [] });
    await expect(active).resolves.toEqual([]);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(queued[0]).resolves.toEqual([]);
    for (const pending of [otherClient, ...queued.slice(1)]) {
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual([]);
    }
    expect(get).toHaveBeenCalledTimes(7);
  });

  it('caps total queued work at 59 while reserving one provider slot for active work', async () => {
    jest.useFakeTimers().setSystemTime(0);
    let completeFirst!: (response: { data: never[] }) => void;
    const get = jest
      .spyOn(axios, 'get')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeFirst = resolve;
          })
      )
      .mockResolvedValue({ data: [] });
    const controller = new GeocodingController();
    const active = controller.search(
      'active',
      'São Paulo',
      'SP',
      requestFrom('active-client')
    );
    const queued = Array.from({ length: 59 }, (_, index) =>
      controller.search(
        `queued-${index}`,
        'São Paulo',
        'SP',
        requestFrom(`client-${index}`)
      )
    );

    await expect(
      controller.search(
        'overflow',
        'São Paulo',
        'SP',
        requestFrom('overflow-client')
      )
    ).rejects.toMatchObject({ status: 429 });
    completeFirst({ data: [] });
    await expect(active).resolves.toEqual([]);
    await jest.advanceTimersByTimeAsync(59_000);
    await expect(Promise.all(queued)).resolves.toHaveLength(59);
    expect(get).toHaveBeenCalledTimes(60);
  });

  it('never overlaps provider requests when a response takes longer than one second', async () => {
    jest.useFakeTimers().setSystemTime(0);
    let completeFirst!: (response: { data: never[] }) => void;
    const get = jest
      .spyOn(axios, 'get')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeFirst = resolve;
          })
      )
      .mockResolvedValue({ data: [] });
    const controller = new GeocodingController();
    const first = controller.search(
      'first',
      'São Paulo',
      'SP',
      requestFrom('192.0.2.70')
    );
    const second = controller.search(
      'second',
      'São Paulo',
      'SP',
      requestFrom('192.0.2.71')
    );

    await jest.advanceTimersByTimeAsync(5_000);
    expect(get).toHaveBeenCalledTimes(1);
    completeFirst({ data: [] });
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid scalar parameters without calling the provider', async () => {
    const get = jest.spyOn(axios, 'get');
    const controller = new GeocodingController();
    await expect(
      controller.search(
        ['A', 'B'],
        'São Paulo',
        'SP',
        requestFrom('192.0.2.50')
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(get).not.toHaveBeenCalled();
  });

  it('releases the active request after provider failure and does not cache failure', async () => {
    jest.useFakeTimers().setSystemTime(0);
    const get = jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: [] });
    const controller = new GeocodingController();
    const first = controller.search(
      'A',
      'B',
      'SP',
      requestFrom('192.0.2.60')
    );
    await expect(first).rejects.toMatchObject({ status: 503 });
    const retry = controller.search(
      'A',
      'B',
      'SP',
      requestFrom('192.0.2.61')
    );
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(retry).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
