import { BadRequestException, Controller, Get, HttpException, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import axios from 'axios';

type Coordinate = { lat: string; lon: string };

@ApiTags('Geocoding')
@Controller('geocoding')
export class GeocodingController {
  private readonly cache = new Map<string, { expires: number; value: Coordinate[] }>();
  private active: { key: string; result: Promise<Coordinate[]> } | null = null;
  private nextRequestAt = 0;

  @Get('search')
  @ApiOperation({ summary: 'Search a Brazilian address using the configured geocoder', description: 'Shares cached results and a single upstream request budget across users of this backend instance.' })
  @ApiQuery({ name: 'street', example: 'Avenida Paulista, 1000' })
  @ApiQuery({ name: 'city', example: 'São Paulo' })
  @ApiQuery({ name: 'state', example: 'SP' })
  @ApiResponse({ status: 200, description: 'Coordinates, or an empty array when no address matches.', schema: { example: [{ lat: '-23.56', lon: '-46.65' }] } })
  @ApiResponse({ status: 429, description: 'The shared provider request budget is busy; try again later.' })
  async search(
    @Query('street') rawStreet: unknown,
    @Query('city') rawCity: unknown,
    @Query('state') rawState: unknown
  ): Promise<Coordinate[]> {
    const street = this.scalar(rawStreet, 256);
    const city = this.scalar(rawCity, 128);
    const state = this.scalar(rawState, 128);
    const key = JSON.stringify([street, city, state]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.active?.key === key) return this.active.result;
    if (this.active || Date.now() < this.nextRequestAt) {
      throw new HttpException('Busca de endereços ocupada. Tente novamente em instantes.', 429);
    }
    this.nextRequestAt = Date.now() + 1_000;
    const result = this.load(street, city, state).then((value) => {
      this.cache.delete(key);
      this.cache.set(key, { expires: Date.now() + 86_400_000, value });
      const oldestKey = this.cache.keys().next().value;
      if (this.cache.size > 500 && oldestKey !== undefined) this.cache.delete(oldestKey);
      return value;
    }).finally(() => { this.active = null; });
    this.active = { key, result };
    return result;
  }

  private scalar(value: unknown, maxLength: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new BadRequestException('Endereço inválido.');
    }
    return value.trim().replace(/\s+/g, ' ');
  }

  private async load(street: string, city: string, state: string): Promise<Coordinate[]> {
    try {
      const response = await axios.get<unknown>(process.env.GEOCODER_SEARCH_URL ?? 'https://nominatim.openstreetmap.org/search', {
        params: { format: 'json', street, city, state, country: 'Brazil', limit: 5 },
        headers: { 'User-Agent': 'MapaCriminalidade/1.0 (https://criminalidade.yudi.com.br)' },
        timeout: 10_000,
        maxContentLength: 262_144,
        maxRedirects: 0,
      });
      if (!Array.isArray(response.data)) throw new Error('Invalid geocoder response');
      return response.data.flatMap((value: unknown) => {
        if (!value || typeof value !== 'object' || !('lat' in value) || !('lon' in value)) return [];
        if (typeof value.lat !== 'string' || typeof value.lon !== 'string' || !value.lat.trim() || !value.lon.trim()) return [];
        const lat = Number(value.lat);
        const lon = Number(value.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
          ? [{ lat: value.lat, lon: value.lon }] : [];
      });
    } catch {
      throw new ServiceUnavailableException('Busca de endereços indisponível. Tente novamente mais tarde.');
    }
  }
}
