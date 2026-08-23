import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { DataImportModule } from './data-import/data-import.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ValidatorsService } from './shared/validators/validators.service';
import { MapFeaturesModule } from './map-features/map-features.module';
import { PrismaModule } from './prisma/prisma.module';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { GqlThrottlerGuard } from './shared/guards/gql-throttler.guard';
import { formatGraphqlError } from './shared/graphql-error-formatter';
import { createGraphqlQueryLimitsRule } from './shared/graphql-query-limits';
import { RequestIdMiddleware } from './shared/observability/request-id.middleware';

const isProduction = process.env.NODE_ENV === 'production';
type GraphqlContextFactoryArgs = { req: unknown; res: unknown };

@Module({
  imports: [
    PrismaModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      path: '/api/graphql',
      autoSchemaFile: true,
      sortSchema: true,
      graphiql: false,
      playground: false,
      introspection: !isProduction,
      validationRules: [createGraphqlQueryLimitsRule()],
      context: ({ req, res }: GraphqlContextFactoryArgs) => ({ req, res }),
      formatError: formatGraphqlError,
      plugins: [
        isProduction
          ? ApolloServerPluginLandingPageDisabled()
          : ApolloServerPluginLandingPageLocalDefault({
              embed: false,
              includeCookies: true,
            }),
      ],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 200,
      },
    ]),
    MapFeaturesModule,
    DataImportModule,
  ],
  controllers: [AppController],
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
