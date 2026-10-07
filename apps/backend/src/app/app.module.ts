import { CensusModule } from './census/census.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { GeocodingController } from './shared/geocoding.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GraphQLModule } from '@nestjs/graphql';
import { DataImportModule } from './data-import/data-import.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ValidatorsService } from './shared/validators/validators.service';
import { MapFeaturesModule } from './map-features/map-features.module';
import { PrismaModule } from './prisma/prisma.module';
import { GqlThrottlerGuard } from './shared/guards/gql-throttler.guard';
import { createGraphqlOptions } from './shared/graphql-options';
import { RequestIdMiddleware } from './shared/observability/request-id.middleware';

@Module({
  imports: [
    PrismaModule,
    CensusModule,
    GraphQLModule.forRoot(createGraphqlOptions()),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 200,
      },
    ]),
    MapFeaturesModule,
    DataImportModule,
  ],
  controllers: [AppController, GeocodingController],
  providers: [
    AppService,
    ValidatorsService,
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
