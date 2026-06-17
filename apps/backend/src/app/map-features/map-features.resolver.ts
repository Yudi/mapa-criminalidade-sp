import { BadRequestException } from '@nestjs/common';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { ValidatorsService } from '../shared/validators/validators.service';
import {
  CategoryStatObject,
  DateRangeObject,
  EtlStatusObject,
  GroupedOccurrenceObject,
  MapFeatureChartsObject,
  MapFeatureCategoryPeriodStatsObject,
  MapFeatureDetailObject,
  MapFeatureFilterInput,
  MapFeatureLocationInput,
  MapFeatureLookupInput,
  MapFeatureMetadataObject,
  MapFeatureSummaryObject,
  PeriodStatObject,
} from './graphql/map-features.graphql';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import {
  MAX_CRIME_TILE_ZOOM,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import {
  normalizeLookup,
  normalizeStringList,
  toQueryParams,
  validateFilterInput,
  validateLocationInput,
} from './utils/map-feature-request.utils';

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TILE_URL_TEMPLATE =
  process.env.TILE_URL_TEMPLATE ?? '/api/tiles/occurrences/{z}/{x}/{y}';

@Resolver()
export class MapFeaturesResolver {
  constructor(
    private readonly queryService: MapFeaturesQueryService,
    private readonly mapper: MapFeaturesMapperService,
    private readonly validatorsService: ValidatorsService
  ) {}

  @Query(() => MapFeatureMetadataObject, { name: 'mapFeaturesMetadata' })
  async getMetadata(): Promise<MapFeatureMetadataObject> {
    const [stats, dateRange, count] = await Promise.all([
      this.queryService.getCategoryPeriodStats(),
      this.queryService.getDateRange(),
      this.queryService.getCount(),
    ]);
    const { categories, periods } = stats;
    const categoryNames = categories.map((category) => category.name);
    const periodNames = periods.map((period) => period.name);

    return {
      format: 'mvt',
      minZoom: MIN_CRIME_TILE_ZOOM,
      maxZoom: MAX_CRIME_TILE_ZOOM,
      layers: ['occurrences'],
      availableCategories: categoryNames,
      availableRubricas: categoryNames,
      availablePeriods: periodNames,
      categoryStats: categories,
      periodStats: periods,
      dateRange,
      totalFeatures: count,
      tileUrlTemplate: TILE_URL_TEMPLATE,
    };
  }

  @Query(() => [CategoryStatObject], { name: 'mapFeaturesCategories' })
  async getCategories(
    @Args('filter', { type: () => MapFeatureFilterInput, nullable: true })
    filter?: MapFeatureFilterInput
  ): Promise<CategoryStatObject[]> {
    return await this.queryService.getCategories(
      this.getQueryParamsFromFilter(filter)
    );
  }

  @Query(() => [PeriodStatObject], { name: 'mapFeaturesPeriods' })
  async getPeriods(
    @Args('filter', { type: () => MapFeatureFilterInput, nullable: true })
    filter?: MapFeatureFilterInput
  ): Promise<PeriodStatObject[]> {
    return await this.queryService.getPeriods(
      this.getQueryParamsFromFilter(filter)
    );
  }

  @Query(() => MapFeatureCategoryPeriodStatsObject, {
    name: 'mapFeaturesCategoryPeriodStats',
  })
  async getCategoryPeriodStats(
    @Args('filter', { type: () => MapFeatureFilterInput, nullable: true })
    filter?: MapFeatureFilterInput
  ): Promise<MapFeatureCategoryPeriodStatsObject> {
    return await this.queryService.getCategoryPeriodStats(
      this.getQueryParamsFromFilter(filter)
    );
  }

  @Query(() => MapFeatureChartsObject, { name: 'mapFeaturesCharts' })
  async getCharts(
    @Args('filter', { type: () => MapFeatureFilterInput, nullable: true })
    filter?: MapFeatureFilterInput
  ): Promise<MapFeatureChartsObject> {
    return await this.queryService.getCharts(
      this.getQueryParamsFromFilter(filter)
    );
  }

  @Query(() => [CategoryStatObject], {
    name: 'mapFeaturesCategoriesForLocation',
  })
  async getCategoriesForLocation(
    @Args('input', { type: () => MapFeatureLocationInput })
    input: MapFeatureLocationInput
  ): Promise<CategoryStatObject[]> {
    validateLocationInput(this.validatorsService, input);

    return await this.queryService.getCategoriesForLocation(
      input.longitude,
      input.latitude,
      input.radius,
      input.beforeDate,
      input.afterDate,
      normalizeStringList(input.periods),
      input.startHour,
      input.endHour
    );
  }

  @Query(() => [MapFeatureSummaryObject], { name: 'mapFeaturesByBo' })
  async getFeaturesByBo(
    @Args('input', { type: () => MapFeatureLookupInput, nullable: true })
    input?: MapFeatureLookupInput,
    @Args('numBo', { nullable: true }) numBo?: string,
    @Args('anoBo', { type: () => Int, nullable: true }) anoBo?: number,
    @Args('delegacia', { nullable: true }) delegacia?: string
  ): Promise<MapFeatureSummaryObject[]> {
    const lookup = normalizeLookup(input, numBo, anoBo, delegacia);
    const features = await this.queryService.getFeatureSummariesByBo(
      lookup.numBo,
      lookup.anoBo,
      lookup.delegacia
    );

    return features.map((feature) => this.mapper.toSummary(feature));
  }

  @Query(() => GroupedOccurrenceObject, {
    name: 'groupedOccurrenceByBo',
    nullable: true,
  })
  async getGroupedOccurrenceByBo(
    @Args('input', { type: () => MapFeatureLookupInput })
    input: MapFeatureLookupInput
  ): Promise<GroupedOccurrenceObject | null> {
    const lookup = normalizeLookup(input);
    const feature = await this.queryService.getFeatureByBo(
      lookup.numBo,
      lookup.anoBo,
      lookup.delegacia
    );

    return feature ? this.mapper.toGroupedOccurrence(feature) : null;
  }

  @Query(() => MapFeatureDetailObject, {
    name: 'mapFeatureFull',
    nullable: true,
  })
  async getFullFeature(
    @Args('input', { type: () => MapFeatureLookupInput })
    input: MapFeatureLookupInput
  ): Promise<MapFeatureDetailObject | null> {
    const lookup = normalizeLookup(input);
    const feature = await this.queryService.getFeatureByBo(
      lookup.numBo,
      lookup.anoBo,
      lookup.delegacia
    );

    if (!feature) {
      return null;
    }

    const imlRecords = await this.queryService.getImlRecordsByBo(
      feature.num_bo,
      feature.ano_bo,
      feature.delegacia
    );
    return this.mapper.toDetail(feature, imlRecords);
  }

  @Query(() => MapFeatureDetailObject, {
    name: 'mapFeatureById',
    nullable: true,
  })
  async getFeatureById(
    @Args('id', { type: () => ID }) id: string
  ): Promise<MapFeatureDetailObject | null> {
    const trimmedId = id.trim();
    if (!UUID_V7_REGEX.test(trimmedId)) {
      throw new BadRequestException('Invalid id');
    }

    const feature = await this.queryService.getFeatureById(trimmedId);
    if (!feature) {
      return null;
    }

    const imlRecords = await this.queryService.getImlRecordsByBo(
      feature.num_bo,
      feature.ano_bo,
      feature.delegacia
    );
    return this.mapper.toDetail(feature, imlRecords);
  }

  @Query(() => DateRangeObject, { name: 'mapFeaturesDateRange' })
  async getDateRange(): Promise<DateRangeObject> {
    return await this.queryService.getDateRange();
  }

  @Query(() => Int, { name: 'mapFeaturesCount' })
  async getCount(
    @Args('filter', { type: () => MapFeatureFilterInput, nullable: true })
    filter?: MapFeatureFilterInput
  ): Promise<number> {
    return await this.queryService.getCount(
      this.getQueryParamsFromFilter(filter)
    );
  }

  @Query(() => [EtlStatusObject], { name: 'mapFeaturesEtlStatus' })
  async getEtlStatus(): Promise<EtlStatusObject[]> {
    const statuses = await this.queryService.getEtlStatus();
    return statuses.map((status) => ({
      source_table: status.source_table,
      status: status.status,
      rows_processed: status.rows_processed,
      last_etl_at: status.last_etl_at?.toISOString() ?? null,
      error_message: status.error_message,
    }));
  }

  private getQueryParamsFromFilter(filter?: MapFeatureFilterInput) {
    validateFilterInput(this.validatorsService, filter);
    return toQueryParams(filter);
  }
}
