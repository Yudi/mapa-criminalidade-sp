import {
  Controller,
  Get,
  Param,
  Query,
  HttpStatus,
  HttpException,
  Post,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MapFeaturesQueryService } from '../services/map-features-query.service';
import { MapFeaturesEtlService } from '../services/map-features-etl.service';
import { ValidatorsService } from '../../shared/validators/validators.service';
import { DevelopmentOnlyGuard } from '../../shared/guards/development-only.guard';
import {
  MAX_CRIME_TILE_ZOOM,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import {
  parseBoundsQuery,
  parseLocationQuery,
  parseOptionalHourQuery,
  parseOptionalIntegerQuery,
  parseStringListQuery,
  validateDateFilters,
  validateHourFilters,
} from '../utils/map-feature-request.utils';
import {
  TILE_URL_TEMPLATE,
  UUID_V7_REGEX,
} from './map-features-controller.constants';

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
