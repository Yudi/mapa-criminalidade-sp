import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CensusAreaDetail,
  CensusAreaSummary,
  CensusLevel,
  CensusReleaseSummary,
} from '@mapa-criminalidade/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { MapFeaturesStatsBulkhead } from '../map-features/services/query/map-features-stats-bulkhead';

export function validateCensusReference(
  releaseId: string,
  level: string,
  code?: string
): asserts level is CensusLevel {
  if (
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(releaseId) ||
    !['municipality', 'neighborhood'].includes(level) ||
    (code !== undefined &&
      !(level === 'municipality' ? /^35\d{5}$/ : /^35\d{8}$/).test(code))
  ) {
    throw new BadRequestException('Invalid census area reference');
  }
}

@Injectable()
export class CensusService {
  private readonly bulkhead = new MapFeaturesStatsBulkhead(1, 32);
  constructor(private readonly prisma: PrismaService) {}

  async release(): Promise<CensusReleaseSummary | null> {
    const [row] = await this.prisma.$queryRawUnsafe<CensusReleaseSummary[]>(`
      SELECT id, year, (manifest->'counts'->>'municipality')::int AS "municipalityCount",
        (manifest->'counts'->>'neighborhood')::int AS "neighborhoodCount"
      FROM census_releases WHERE active`);
    return row ?? null;
  }

  async search(
    releaseId: string,
    level: string,
    search: string
  ): Promise<CensusAreaSummary[]> {
    validateCensusReference(releaseId, level);
    const query = search.trim();
    if (query.length < 2 || query.length > 100)
      throw new BadRequestException('Search must have 2-100 characters');
    return this.prisma.$queryRawUnsafe<CensusAreaSummary[]>(
      `
      SELECT release_id AS "releaseId", level, code, name, municipality_name AS "municipalityName"
      FROM census_areas WHERE release_id=$1 AND level=$2
        AND (strpos(lower(name), lower($3)) > 0 OR code=$3)
      ORDER BY name, municipality_name, code LIMIT 30`,
      releaseId,
      level,
      query
    );
  }

  async detail(
    releaseId: string,
    level: string,
    code: string
  ): Promise<CensusAreaDetail> {
    validateCensusReference(releaseId, level, code);
    const [row] = await this.prisma.$queryRawUnsafe<CensusAreaDetail[]>(
      `
      SELECT a.release_id AS "releaseId", a.level, a.code, a.name,
        a.municipality_name AS "municipalityName", a.population, a.area_km2 AS "areaKm2",
        a.indicators, r.year,
        ARRAY[ST_XMin(a.geom),ST_YMin(a.geom),ST_XMax(a.geom),ST_YMax(a.geom)] AS bounds
      FROM census_areas a JOIN census_releases r ON r.id=a.release_id
      WHERE a.release_id=$1 AND a.level=$2 AND a.code=$3`,
      releaseId,
      level,
      code
    );
    if (!row) throw new NotFoundException('Census area not found');
    return row;
  }

  async tile(
    releaseId: string,
    level: string,
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal
  ): Promise<Buffer> {
    validateCensusReference(releaseId, level);
    if (
      ![z, x, y].every(Number.isInteger) ||
      z < 0 ||
      z > 19 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    )
      throw new BadRequestException('Invalid tile');
    return this.bulkhead.run(async () => {
      const [row] = await this.prisma.executeCancelableReadOnlyQuery<{
        tile: Buffer;
      }>(
        'SELECT public.census_areas_tile($1::int,$2::int,$3::int,$4::json) AS tile',
        [z, x, y, JSON.stringify({ release: releaseId, level })],
        signal
      );
      return row?.tile ?? Buffer.alloc(0);
    });
  }
}
