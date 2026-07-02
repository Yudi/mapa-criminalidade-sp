import { Controller, Get, Param, Query, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MapFeaturesQueryService } from '../services/map-features-query.service';
import { MapFeaturesMapperService } from '../services/map-features-mapper.service';
import { ValidatorsService } from '../../shared/validators/validators.service';
import {
  parseBoundsQuery,
  parseIntegerParam,
  parseLocationQuery,
  parseOptionalIntegerQuery,
  validateDateFilters,
} from '../utils/map-feature-request.utils';

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
