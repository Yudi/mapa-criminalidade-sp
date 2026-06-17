import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Req,
  HttpStatus,
  HttpException,
  Post,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import { MapFeaturesEtlService } from './services/map-features-etl.service';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { ValidatorsService } from '../shared/validators/validators.service';
import { DevelopmentOnlyGuard } from '../shared/guards/development-only.guard';
import {
  MAX_CRIME_TILE_ZOOM,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import {
  parseBoundsQuery,
  parseIntegerParam,
  parseLocationQuery,
  parseOptionalHourQuery,
  parseOptionalIntegerQuery,
  parseStringListQuery,
  validateDateFilters,
  validateHourFilters,
} from './utils/map-feature-request.utils';

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TILE_STATUS_HEADER = 'X-Map-Tile-Status';
const TILE_URL_TEMPLATE =
  process.env.TILE_URL_TEMPLATE ?? '/api/tiles/occurrences/{z}/{x}/{y}';

function isBelowTileDataZoom(zoom: number): boolean {
  return zoom < MIN_CRIME_TILE_ZOOM;
}
@ApiTags('Map Features')
@Controller('map-features')
export class MapFeaturesController {
  private readonly logger = new Logger(MapFeaturesController.name);

  constructor(
    private readonly queryService: MapFeaturesQueryService,
    private readonly etlService: MapFeaturesEtlService,
    private readonly validatorsService: ValidatorsService
  ) {}
  @Get('metadata')
  @ApiOperation({ summary: 'Get tile metadata including available categories' })
  async getMetadata() {
    const [categories, periods, dateRange, count] = await Promise.all([
      this.queryService.getCategories(),
      this.queryService.getPeriods(),
      this.queryService.getDateRange(),
      this.queryService.getCount(),
    ]);

    const categoryNames = categories.map((c) => c.name);

    return {
      format: 'mvt',
      minZoom: MIN_CRIME_TILE_ZOOM,
      maxZoom: MAX_CRIME_TILE_ZOOM,
      layers: ['occurrences'],
      availableCategories: categoryNames,
      availableRubricas: categoryNames,
      availablePeriods: periods.map((period) => period.name),
      categoryStats: categories,
      periodStats: periods,
      dateRange,
      totalFeatures: count,
      tileUrlTemplate: TILE_URL_TEMPLATE,
    };
  }
  @Get('categories')
  @ApiOperation({ summary: 'Get categories with counts' })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'after', required: false })
  @ApiQuery({ name: 'minLon', required: false, type: Number })
  @ApiQuery({ name: 'minLat', required: false, type: Number })
  @ApiQuery({ name: 'maxLon', required: false, type: Number })
  @ApiQuery({ name: 'maxLat', required: false, type: Number })
  @ApiQuery({ name: 'periods', required: false })
  @ApiQuery({ name: 'startHour', required: false, type: Number })
  @ApiQuery({ name: 'endHour', required: false, type: Number })
  async getCategories(
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('minLon') minLon?: string,
    @Query('minLat') minLat?: string,
    @Query('maxLon') maxLon?: string,
    @Query('maxLat') maxLat?: string,
    @Query('periods') periods?: string,
    @Query('startHour') startHour?: string,
    @Query('endHour') endHour?: string
  ) {
    validateDateFilters(this.validatorsService, before, after);
    const parsedStartHour = parseOptionalHourQuery(startHour, 'startHour');
    const parsedEndHour = parseOptionalHourQuery(endHour, 'endHour');
    validateHourFilters(parsedStartHour, parsedEndHour);
    const bounds = parseBoundsQuery(
      this.validatorsService,
      minLon,
      minLat,
      maxLon,
      maxLat
    );

    return await this.queryService.getCategories({
      beforeDate: before,
      afterDate: after,
      periods: parseStringListQuery(periods),
      startHour: parsedStartHour,
      endHour: parsedEndHour,
      ...bounds,
    });
  }
  @Get('categories/location')
  @ApiOperation({ summary: 'Get categories within radius of a location' })
  @ApiQuery({ name: 'lon', required: true, type: Number })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({
    name: 'radius',
    required: true,
    type: Number,
    description: 'Radius in meters',
  })
  @ApiQuery({ name: 'before', required: false })
  @ApiQuery({ name: 'after', required: false })
  async getCategoriesForLocation(
    @Query('lon') lon: string,
    @Query('lat') lat: string,
    @Query('radius') radius: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('periods') periods?: string,
    @Query('startHour') startHour?: string,
    @Query('endHour') endHour?: string
  ) {
    validateDateFilters(this.validatorsService, before, after);
    const parsedStartHour = parseOptionalHourQuery(startHour, 'startHour');
    const parsedEndHour = parseOptionalHourQuery(endHour, 'endHour');
    validateHourFilters(parsedStartHour, parsedEndHour);
    const location = parseLocationQuery(
      this.validatorsService,
      lon,
      lat,
      radius
    );

    return await this.queryService.getCategoriesForLocation(
      location.lon,
      location.lat,
      location.radius,
      before,
      after,
      parseStringListQuery(periods),
      parsedStartHour,
      parsedEndHour
    );
  }
  /** Uses the registration police unit to disambiguate pre-2022 BO numbers. */
  @Get('feature/:numBo')
  @ApiOperation({ summary: 'Get feature details by NUM_BO' })
  @ApiParam({ name: 'numBo', description: 'NUM_BO identifier' })
  @ApiQuery({ name: 'ano', required: false, type: Number })
  @ApiQuery({
    name: 'delegacia',
    required: false,
    type: String,
    description:
      'Registration police unit, sourced from NOME_DELEGACIA (required for unique lookup before 2022)',
  })
  async getFeatureByBo(
    @Param('numBo') numBo: string,
    @Query('ano') ano?: string,
    @Query('delegacia') delegacia?: string
  ) {
    const anoBo = parseOptionalIntegerQuery(ano, 'ano');
    const features = await this.queryService.getFeaturesByBo(
      numBo.trim(),
      anoBo,
      delegacia?.trim()
    );

    if (features.length === 0) {
      throw new HttpException('Feature not found', HttpStatus.NOT_FOUND);
    }

    return features;
  }
  @Get('feature/id/:id')
  @ApiOperation({ summary: 'Get feature by internal ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getFeatureById(@Param('id') id: string) {
    const parsedId = id.trim();
    if (!UUID_V7_REGEX.test(parsedId)) {
      throw new HttpException('Invalid ID', HttpStatus.BAD_REQUEST);
    }

    const feature = await this.queryService.getFeatureById(parsedId);
    if (!feature) {
      throw new HttpException('Feature not found', HttpStatus.NOT_FOUND);
    }

    return feature;
  }
  @Get('etl/status')
  @ApiOperation({ summary: 'Get ETL processing status' })
  async getEtlStatus() {
    return await this.queryService.getEtlStatus();
  }
  @Post('etl/run')
  @UseGuards(DevelopmentOnlyGuard)
  @ApiOperation({ summary: 'Trigger full ETL processing' })
  async runEtl() {
    this.logger.log('ETL triggered via API');
    const result = await this.etlService.runFullEtl();
    return {
      message: 'ETL completed',
      ...result,
    };
  }
  @Post('etl/incremental')
  @UseGuards(DevelopmentOnlyGuard)
  @ApiOperation({ summary: 'Trigger incremental ETL for updated tables' })
  async runIncrementalEtl() {
    this.logger.log('Incremental ETL triggered via API');
    const result = await this.etlService.runIncrementalEtl();
    return {
      message: 'Incremental ETL completed',
      ...result,
    };
  }
}
@ApiTags('Tiles')
@Controller('tiles')
export class TilesController {
  constructor(
    private readonly queryService: MapFeaturesQueryService,
    private readonly validatorsService: ValidatorsService
  ) {}

  @Get('metadata')
  @ApiOperation({ summary: 'Get tile metadata' })
  async getMetadata() {
    const [categories, periods, dateRange] = await Promise.all([
      this.queryService.getCategories(),
      this.queryService.getPeriods(),
      this.queryService.getDateRange(),
    ]);
    const categoryNames = categories.map((c) => c.name);

    return {
      format: 'mvt',
      minZoom: MIN_CRIME_TILE_ZOOM,
      maxZoom: MAX_CRIME_TILE_ZOOM,
      layers: ['occurrences'],
      availableCategories: categoryNames,
      availableRubricas: categoryNames, // Backwards compat
      availablePeriods: periods.map((period) => period.name),
      categoryStats: categories,
      periodStats: periods,
      dateRange,
      tileUrlTemplate: TILE_URL_TEMPLATE,
    };
  }

  @SkipThrottle()
  @Get(':z/:x/:y.mvt')
  @ApiOperation({ summary: 'Get MVT tile' })
  async getTile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Query('before') before: string,
    @Query('after') after: string,
    @Query('categories') categories: string,
    @Query('rubricas') rubricas: string, // Backwards compat
    @Query('periods') periods: string,
    @Query('startHour') startHour: string,
    @Query('endHour') endHour: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (req.socket?.destroyed) {
      return;
    }

    const parsedZ = parseIntegerParam(z, 'z');
    const parsedX = parseIntegerParam(x, 'x');
    const parsedY = parseIntegerParam(y, 'y');

    if (parsedZ < 0 || parsedZ > MAX_CRIME_TILE_ZOOM) {
      throw new HttpException(
        `Zoom level must be between 0 and ${MAX_CRIME_TILE_ZOOM}`,
        HttpStatus.BAD_REQUEST
      );
    }

    const maxTile = Math.pow(2, parsedZ);
    if (
      parsedX < 0 ||
      parsedX >= maxTile ||
      parsedY < 0 ||
      parsedY >= maxTile
    ) {
      throw new HttpException(
        'Tile coordinates out of range',
        HttpStatus.BAD_REQUEST
      );
    }

    validateDateFilters(this.validatorsService, before, after);
    const parsedStartHour = parseOptionalHourQuery(startHour, 'startHour');
    const parsedEndHour = parseOptionalHourQuery(endHour, 'endHour');
    validateHourFilters(parsedStartHour, parsedEndHour);

    if (isBelowTileDataZoom(parsedZ)) {
      return res.status(HttpStatus.NO_CONTENT).send();
    }

    // Support both 'categories' and 'rubricas' for backwards compatibility
    const categoryFilter = categories || rubricas;
    const categoryList = parseStringListQuery(categoryFilter);
    const periodList = parseStringListQuery(periods);

    let clientDisconnected = false;
    const onClose = () => {
      clientDisconnected = true;
    };
    req.on('close', onClose);

    try {
      if (clientDisconnected || req.socket?.destroyed) {
        return;
      }

      const tile = await this.queryService.getTile({
        z: parsedZ,
        x: parsedX,
        y: parsedY,
        beforeDate: before,
        afterDate: after,
        categories: categoryList,
        periods: periodList,
        startHour: parsedStartHour,
        endHour: parsedEndHour,
      });

      if (clientDisconnected || req.socket?.destroyed) {
        return;
      }

      res.set({
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': TILE_STATUS_HEADER,
      });

      if (tile.status === 'timeout') {
        res.set({
          [TILE_STATUS_HEADER]: 'timeout',
          'Cache-Control': 'no-store',
        });
        return res.status(HttpStatus.NO_CONTENT).send();
      }

      if (!tile.tile || tile.tile.length === 0) {
        return res.status(HttpStatus.NO_CONTENT).send();
      }

      return res.send(tile.tile);
    } catch {
      if (clientDisconnected || req.socket?.destroyed) {
        return;
      }
      throw new HttpException(
        'Error generating tile',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    } finally {
      req.off('close', onClose);
    }
  }
}
@ApiTags('Occurrences')
@Controller('occurrences')
export class OccurrencesController {
  constructor(
    private readonly queryService: MapFeaturesQueryService,
    private readonly mapper: MapFeaturesMapperService,
    private readonly validatorsService: ValidatorsService
  ) {}
  @Get('categories-for-bounds')
  @ApiOperation({ summary: 'Get categories within visible bounds' })
  async getCategoriesForBounds(
    @Query('minLon') minLon: string,
    @Query('minLat') minLat: string,
    @Query('maxLon') maxLon: string,
    @Query('maxLat') maxLat: string,
    @Query('before') before?: string,
    @Query('after') after?: string
  ) {
    validateDateFilters(this.validatorsService, before, after);
    const bounds = parseBoundsQuery(
      this.validatorsService,
      minLon,
      minLat,
      maxLon,
      maxLat
    );

    return await this.queryService.getCategories({
      beforeDate: before,
      afterDate: after,
      ...bounds,
    });
  }
  @Get('categories-for-location')
  @ApiOperation({ summary: 'Get categories within radius of location' })
  async getCategoriesForLocation(
    @Query('lon') lon: string,
    @Query('lat') lat: string,
    @Query('radius') radius: string,
    @Query('before') before?: string,
    @Query('after') after?: string
  ) {
    validateDateFilters(this.validatorsService, before, after);
    const location = parseLocationQuery(
      this.validatorsService,
      lon,
      lat,
      radius
    );

    return await this.queryService.getCategoriesForLocation(
      location.lon,
      location.lat,
      location.radius,
      before,
      after
    );
  }
  /** Uses the registration police unit to disambiguate pre-2022 BO numbers. */
  @Get('by-num-bo/:numBo/:anoBo')
  @ApiOperation({ summary: 'Get features by NUM_BO and ANO_BO' })
  @ApiParam({ name: 'numBo', description: 'Boletim number' })
  @ApiParam({ name: 'anoBo', description: 'Year of the boletim' })
  @ApiQuery({
    name: 'delegacia',
    required: false,
    type: String,
    description:
      'Registration police unit, sourced from NOME_DELEGACIA (required for unique lookup before 2022)',
  })
  async getByNumBoAndYear(
    @Param('numBo') numBo: string,
    @Param('anoBo') anoBo: string,
    @Query('delegacia') delegacia?: string
  ) {
    const parsedAnoBo = parseIntegerParam(anoBo, 'anoBo');

    const features = await this.queryService.getFeaturesByBo(
      numBo.trim(),
      parsedAnoBo,
      delegacia?.trim()
    );

    if (features.length === 0) {
      throw new HttpException('Feature not found', HttpStatus.NOT_FOUND);
    }

    // Transform to GroupedOccurrence format for backwards compatibility
    return this.mapper.toGroupedOccurrence(features[0]);
  }
  /** Uses the registration police unit to disambiguate pre-2022 BO numbers. */
  @Get('by-num-bo/:numBo')
  @ApiOperation({ summary: 'Get features by NUM_BO' })
  @ApiQuery({
    name: 'delegacia',
    required: false,
    type: String,
    description:
      'Registration police unit, sourced from NOME_DELEGACIA (required for unique lookup before 2022)',
  })
  async getByNumBo(
    @Param('numBo') numBo: string,
    @Query('ano') ano?: string,
    @Query('delegacia') delegacia?: string
  ) {
    const anoBo = parseOptionalIntegerQuery(ano, 'ano');
    const features = await this.queryService.getFeaturesByBo(
      numBo.trim(),
      anoBo,
      delegacia?.trim()
    );

    if (features.length === 0) {
      throw new HttpException('Feature not found', HttpStatus.NOT_FOUND);
    }

    // Transform to GroupedOccurrence format for backwards compatibility
    return this.mapper.toGroupedOccurrence(features[0]);
  }
  /** Uses the registration police unit to disambiguate pre-2022 BO numbers. */
  @Get('full/:numBo/:anoBo')
  @ApiOperation({ summary: 'Get full feature data including all records' })
  @ApiQuery({
    name: 'delegacia',
    required: false,
    type: String,
    description:
      'Registration police unit, sourced from NOME_DELEGACIA (required for unique lookup before 2022)',
  })
  async getFullFeature(
    @Param('numBo') numBo: string,
    @Param('anoBo') anoBo: string,
    @Query('delegacia') delegacia?: string
  ) {
    const parsedAnoBo = parseIntegerParam(anoBo, 'anoBo');

    const features = await this.queryService.getFeaturesByBo(
      numBo.trim(),
      parsedAnoBo,
      delegacia?.trim()
    );

    if (features.length === 0) {
      throw new HttpException('Feature not found', HttpStatus.NOT_FOUND);
    }

    const feature = features[0];
    const imlRecords = await this.queryService.getImlRecordsByBo(
      feature.num_bo,
      feature.ano_bo,
      feature.delegacia
    );

    return this.mapper.toDetail(feature, imlRecords);
  }
  @Get('categories')
  @ApiOperation({ summary: 'Get all categories with counts' })
  async getCategories(
    @Query('before') before?: string,
    @Query('after') after?: string
  ) {
    validateDateFilters(this.validatorsService, before, after);

    return await this.queryService.getCategories({
      beforeDate: before,
      afterDate: after,
    });
  }
}
