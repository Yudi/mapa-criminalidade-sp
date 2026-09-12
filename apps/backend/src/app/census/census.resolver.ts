import { BadRequestException } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { occurrencesPer100k } from '@mapa-criminalidade/shared-types';
import { CensusService } from './census.service';
import {
  CensusAreaObject,
  CensusAreaSummaryObject,
  CensusCrimeStatsObject,
  CensusReleaseObject,
} from './census.graphql';
import {
  CensusAreaReferenceInput,
  MapFeatureFilterInput,
} from '../map-features/graphql/map-features.graphql';
import { MapFeaturesQueryService } from '../map-features/services/map-features-query.service';
import {
  toQueryParams,
  validateFilterInput,
} from '../map-features/utils/map-feature-request.utils';
import { ValidatorsService } from '../shared/validators/validators.service';

@Resolver()
export class CensusResolver {
  constructor(
    private readonly census: CensusService,
    private readonly crimes: MapFeaturesQueryService,
    private readonly validators: ValidatorsService
  ) {}

  @Query(() => CensusReleaseObject, {
    nullable: true,
    description:
      'Active backend-managed SP census release; null until initial loading completes.',
  })
  censusRelease() {
    return this.census.release();
  }

  @Query(() => [CensusAreaSummaryObject], {
    description:
      'Find at most 30 official SP areas by name or code; no crime scan.',
  })
  censusAreas(
    @Args('releaseId') releaseId: string,
    @Args('level') level: string,
    @Args('search') search: string
  ) {
    return this.census.search(releaseId, level, search);
  }

  @Query(() => CensusAreaObject)
  censusArea(@Args('area') area: CensusAreaReferenceInput) {
    return this.census.detail(area.releaseId, area.level, area.code);
  }

  @Query(() => CensusCrimeStatsObject, {
    description:
      'Geocoded occurrence count inside the full official polygon, with inclusive dates and all active filters. Per 100,000 census residents; not annualized.',
  })
  async censusCrimeStats(
    @Args('area') area: CensusAreaReferenceInput,
    @Args('filter') filter: MapFeatureFilterInput
  ) {
    const scopedFilter = {
      ...filter,
      bounds: undefined,
      area: { census: area },
    };
    validateFilterInput(this.validators, scopedFilter);
    if (!filter.afterDate || !filter.beforeDate)
      throw new BadRequestException(
        'Census crime rates require both date bounds'
      );
    const detail = await this.census.detail(
      area.releaseId,
      area.level,
      area.code
    );
    const occurrences = await this.crimes.getCount(toQueryParams(scopedFilter));
    return {
      occurrences,
      per100k: occurrencesPer100k(occurrences, detail.population),
      after: filter.afterDate,
      before: filter.beforeDate,
    };
  }
}
