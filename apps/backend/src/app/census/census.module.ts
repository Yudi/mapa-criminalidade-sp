import { Module } from '@nestjs/common';
import { MapFeaturesModule } from '../map-features/map-features.module';
import { ValidatorsService } from '../shared/validators/validators.service';
import { CensusController } from './census.controller';
import { CensusResolver } from './census.resolver';
import { CensusService } from './census.service';

@Module({
  imports: [MapFeaturesModule],
  controllers: [CensusController],
  providers: [CensusService, CensusResolver, ValidatorsService],
})
export class CensusModule {}
