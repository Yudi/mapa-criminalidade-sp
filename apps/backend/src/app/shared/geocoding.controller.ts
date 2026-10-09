import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import axios from 'axios';

type Coordinate = { lat: string; lon: string };

interface PendingRequest {
  key: string;
  street: string;
  city: string;
  state: string;
  result: Promise<Coordinate[]>;
  resolve(value: Coordinate[]): void;
  reject(reason: unknown): void;
}

const CACHE_TTL_MS = 86_400_000;
const CLIENT_WINDOW_MS = 60_000;
const CLIENT_REQUEST_LIMIT = 10;
const MAX_TRACKED_CLIENTS = 10_000;
const MAX_QUEUED_REQUESTS = 59;
const MAX_PENDING_PER_CLIENT = 5;
const PROVIDER_INTERVAL_MS = 1_000;

@ApiTags('Geocoding')
@Controller('geocoding')
export class GeocodingController {
  private readonly cache = new Map<
    string,
    { expires: number; value: Coordinate[] }
  >();
  private readonly clientRequestTimes = new Map<string, number[]>();
  private readonly clientQueues = new Map<string, PendingRequest[]>();
  private readonly clientOrder: string[] = [];
  private readonly pendingByKey = new Map<string, PendingRequest>();
  private queuedRequestCount = 0;
  private active = false;
  private nextRequestAt = 0;
  private queueTimer: ReturnType<typeof setTimeout> | null = null;

  @Get('search')
  @ApiOperation({
    summary: 'Search a Brazilian address using the configured geocoder',
    description:
      'Caches and coalesces requests, limits each client to 10 searches per minute, and shares a fair, bounded one-request-per-second provider queue across users.',
  })
  @ApiQuery({ name: 'street', example: 'Avenida Paulista, 1000' })
  @ApiQuery({ name: 'city', example: 'São Paulo' })
  @ApiQuery({ name: 'state', example: 'SP' })
  @ApiResponse({
    status: 200,
    description: 'Coordinates, or an empty array when no address matches.',
    schema: { example: [{ lat: '-23.56', lon: '-46.65' }] },
  })
  @ApiResponse({
    status: 429,
    description:
      'The client exceeded its request limit or the bounded provider queue is full.',
  })
  async search(
    @Query('street') rawStreet: unknown,
    @Query('city') rawCity: unknown,
    @Query('state') rawState: unknown,
    @Req() request: Request
  ): Promise<Coordinate[]> {
    const street = this.scalar(rawStreet, 256);
    const city = this.scalar(rawCity, 128);
    const state = this.scalar(rawState, 128);
    const clientIp = request.ip || 'unknown';
    this.enforceClientLimit(clientIp);

    const key = JSON.stringify([street, city, state]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (cached) this.cache.delete(key);

    const existing = this.pendingByKey.get(key);
    if (existing) return existing.result;

    const clientQueue = this.clientQueues.get(clientIp);
    if (
      this.queuedRequestCount >= MAX_QUEUED_REQUESTS ||
      (clientQueue?.length ?? 0) >= MAX_PENDING_PER_CLIENT
    ) {
      throw new HttpException(
        'Fila de busca de endereços cheia. Tente novamente em instantes.',
        429
      );
    }

    let resolve!: (value: Coordinate[]) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<Coordinate[]>((resolveResult, rejectResult) => {
      resolve = resolveResult;
      reject = rejectResult;
    });
    const pending: PendingRequest = {
      key,
      street,
      city,
      state,
      result,
      resolve,
      reject,
    };

    if (!clientQueue) {
      this.clientQueues.set(clientIp, []);
      this.clientOrder.push(clientIp);
    }
    this.clientQueues.get(clientIp)?.push(pending);
    this.pendingByKey.set(key, pending);
    this.queuedRequestCount++;
    this.scheduleNext();

    return result;
  }

  private enforceClientLimit(clientIp: string): void {
    const now = Date.now();
    const recentRequests = (this.clientRequestTimes.get(clientIp) ?? []).filter(
      (requestAt) => now - requestAt < CLIENT_WINDOW_MS
    );
    if (recentRequests.length >= CLIENT_REQUEST_LIMIT) {
      throw new HttpException(
        'Limite de buscas excedido. Tente novamente em instantes.',
        429
      );
    }

    recentRequests.push(now);
    this.clientRequestTimes.delete(clientIp);
    this.clientRequestTimes.set(clientIp, recentRequests);
    if (this.clientRequestTimes.size > MAX_TRACKED_CLIENTS) {
      const oldestClient = this.clientRequestTimes.keys().next().value;
      if (oldestClient !== undefined) {
        this.clientRequestTimes.delete(oldestClient);
      }
    }
  }

  private scheduleNext(): void {
    if (
      this.active ||
      this.queueTimer !== null ||
      this.queuedRequestCount === 0
    ) {
      return;
    }

    const delay = Math.max(0, this.nextRequestAt - Date.now());
    if (delay === 0) {
      void this.processNext();
      return;
    }

    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      void this.processNext();
    }, delay);
  }

  private async processNext(): Promise<void> {
    if (this.active) return;
    const pending = this.dequeueNext();
    if (!pending) return;

    this.active = true;
    this.nextRequestAt = Date.now() + PROVIDER_INTERVAL_MS;
    try {
      const value = await this.load(pending.street, pending.city, pending.state);
      this.cache.delete(pending.key);
      this.cache.set(pending.key, {
        expires: Date.now() + CACHE_TTL_MS,
        value,
      });
      const oldestKey = this.cache.keys().next().value;
      if (this.cache.size > 500 && oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
      pending.resolve(value);
    } catch (error) {
      pending.reject(error);
    } finally {
      this.pendingByKey.delete(pending.key);
      this.active = false;
      this.scheduleNext();
    }
  }

  private dequeueNext(): PendingRequest | null {
    while (this.clientOrder.length > 0) {
      const clientIp = this.clientOrder.shift();
      if (clientIp === undefined) return null;

      const queue = this.clientQueues.get(clientIp);
      const pending = queue?.shift();
      if (!queue || !pending) {
        this.clientQueues.delete(clientIp);
        continue;
      }

      this.queuedRequestCount--;
      if (queue.length > 0) this.clientOrder.push(clientIp);
      else this.clientQueues.delete(clientIp);
      return pending;
    }
    return null;
  }

  private scalar(value: unknown, maxLength: number): string {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > maxLength ||
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    ) {
      throw new BadRequestException('Endereço inválido.');
    }
    return value.trim().replace(/\s+/g, ' ');
  }

  private async load(
    street: string,
    city: string,
    state: string
  ): Promise<Coordinate[]> {
    try {
      const response = await axios.get<unknown>(
        process.env.GEOCODER_SEARCH_URL ??
          'https://nominatim.openstreetmap.org/search',
        {
          params: {
            format: 'json',
            street,
            city,
            state,
            country: 'Brazil',
            limit: 5,
          },
          headers: {
            'User-Agent':
              'MapaCriminalidade/1.0 (https://criminalidade.yudi.com.br)',
          },
          timeout: 10_000,
          maxContentLength: 262_144,
          maxRedirects: 0,
        }
      );
      if (!Array.isArray(response.data))
        throw new Error('Invalid geocoder response');
      return response.data.flatMap((value: unknown) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('lat' in value) ||
          !('lon' in value)
        )
          return [];
        if (
          typeof value.lat !== 'string' ||
          typeof value.lon !== 'string' ||
          !value.lat.trim() ||
          !value.lon.trim()
        )
          return [];
        const lat = Number(value.lat);
        const lon = Number(value.lon);
        return Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180
          ? [{ lat: value.lat, lon: value.lon }]
          : [];
      });
    } catch {
      throw new ServiceUnavailableException(
        'Busca de endereços indisponível. Tente novamente mais tarde.'
      );
    }
  }
}
