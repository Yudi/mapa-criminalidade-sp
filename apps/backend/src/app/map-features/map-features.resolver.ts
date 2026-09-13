import { BadRequestException } from '@nestjs/common';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ValidatorsService } from '../shared/validators/validators.service';
import { DevelopmentOnlyGuard } from '../shared/guards/development-only.guard';
import {
  MapFeatureTemporalStatsObject,
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
import { AmbiguousMapFeatureLookupError } from './services/query/map-features-detail-query';
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

type MetadataResult = {
  [Key in keyof MapFeatureMetadataObject]:
    | MapFeatureMetadataObject[Key]
    | Promise<MapFeatureMetadataObject[Key]>;
};

@Resolver()
export class MapFeaturesResolver {
  constructor(
    private readonly queryService: MapFeaturesQueryService,
    private readonly mapper: MapFeaturesMapperService,
    private readonly validatorsService: ValidatorsService
  ) {}

  @Query(() => MapFeatureMetadataObject, { name: 'mapFeaturesMetadata' })
  async getMetadata(): Promise<MetadataResult> {
    return this.loadMetadata();
  }

  private async loadMetadata(
    retried = false
  ): Promise<MetadataResult> {
    const datasetRevision = await this.queryService.getDatasetRevision();
    const dateRange = await this.queryService.getDateRange();
    if (datasetRevision !== (await this.queryService.getDatasetRevision())) {
      if (retried)
        throw new Error(
          'Dataset changed during metadata loading; retry the request'
        );
      return this.loadMetadata(true);
    }
    // GraphQL reads only selected properties. Share one lazy scan across all
    // aggregate fields, including aliases and fragments in legacy queries.
    const verifyRevision = async <T>(value: T): Promise<T> => {
      if (datasetRevision !== (await this.queryService.getDatasetRevision())) {
        throw new Error('Dataset changed during metadata loading; retry the request');
      }
      return value;
    };
    let stats: ReturnType<MapFeaturesQueryService['getCategoryPeriodStats']> | undefined;
    const loadStats = () =>
      (stats ??= this.queryService.getCategoryPeriodStats().then(verifyRevision));
    let count: Promise<number> | undefined;
    const queryService = this.queryService;

    return {
      format: 'mvt',
      datasetRevision,
      minZoom: MIN_CRIME_TILE_ZOOM,
      maxZoom: MAX_CRIME_TILE_ZOOM,
      layers: ['occurrences'],
      get availableCategories() {
        return loadStats().then(({ categories }) => categories.map(({ name }) => name));
      },
      get availableRubricas() {
        return loadStats().then(({ categories }) => categories.map(({ name }) => name));
      },
      get availablePeriods() {
        return loadStats().then(({ periods }) => periods.map(({ name }) => name));
      },
      get categoryStats() {
        return loadStats().then(({ categories }) => categories);
      },
      get periodStats() {
        return loadStats().then(({ periods }) => periods);
      },
      dateRange,
      get totalFeatures() {
        return (count ??= queryService.getCount().then(verifyRevision));
      },
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

  @Query(() => MapFeatureTemporalStatsObject, {
    name: 'mapFeaturesTemporalStats',
    description:
      'Monthly and category occurrence counts for a fixed area, over at most 120 calendar months. Date bounds are inclusive; absent months have zero recorded occurrences, not certified source coverage.',
  })
  async getTemporalStats(
    @Args('filter', { type: () => MapFeatureFilterInput })
    filter: MapFeatureFilterInput
  ): Promise<MapFeatureTemporalStatsObject> {
    const params = this.getQueryParamsFromFilter(filter);
    if (
      !params.afterDate ||
      !params.beforeDate ||
      (!filter.area && !filter.bounds)
    ) {
      throw new BadRequestException(
        'Temporal analysis requires an area and both date bounds'
      );
    }
    const start = new Date(params.afterDate);
    const end = new Date(params.beforeDate);
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      end.getUTCMonth() -
      start.getUTCMonth() +
      1;
    if (months > 120)
      throw new BadRequestException(
        'Temporal analysis supports at most 120 months'
      );
    return this.queryService.getTemporalStats(params);
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
    let feature;
    try {
      feature = await this.queryService.getFeatureByBo(
        lookup.numBo,
        lookup.anoBo,
        lookup.delegacia
      );
    } catch (error) {
      if (error instanceof AmbiguousMapFeatureLookupError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

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
    let feature;
    try {
      feature = await this.queryService.getFeatureByBo(
        lookup.numBo,
        lookup.anoBo,
        lookup.delegacia
      );
    } catch (error) {
      if (error instanceof AmbiguousMapFeatureLookupError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (!feature) {
      return null;
    }

    const enrichment = await this.queryService.getImlEnrichment(feature);
    return {
      ...this.mapper.toDetail(feature, enrichment.records),
      imlUnavailable: enrichment.unavailable,
    };
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

    const enrichment = await this.queryService.getImlEnrichment(feature);
    return {
      ...this.mapper.toDetail(feature, enrichment.records),
      imlUnavailable: enrichment.unavailable,
    };
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
  @UseGuards(DevelopmentOnlyGuard)
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
