import { Module } from '@nestjs/common';
import {
  MapFeaturesController,
  TilesController,
  OccurrencesController,
} from './map-features.controller';
import { MapFeaturesResolver } from './map-features.resolver';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import { MapFeaturesEtlService } from './services/map-features-etl.service';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { ValidatorsService } from '../shared/validators/validators.service';
import { DevelopmentOnlyGuard } from '../shared/guards/development-only.guard';
import { RedisCacheService } from '../shared/cache/redis-cache.service';
@Module({
  controllers: [MapFeaturesController, TilesController, OccurrencesController],
  providers: [
    RedisCacheService,
    MapFeaturesQueryService,
    MapFeaturesEtlService,
    MapFeaturesMapperService,
    MapFeaturesResolver,
    ValidatorsService,
    DevelopmentOnlyGuard,
  ],
  exports: [MapFeaturesQueryService, MapFeaturesEtlService],
})
export class MapFeaturesModule {}
