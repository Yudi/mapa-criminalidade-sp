import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { parseAllowedOrigins } from './app/shared/cors.util';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const logLevels: (
    | 'error'
    | 'warn'
    | 'log'
    | 'debug'
    | 'verbose'
    | 'fatal'
  )[] = isProduction
    ? ['error', 'warn', 'log', 'fatal']
    : ['error', 'warn', 'log', 'debug', /*'verbose',*/ 'fatal'];
  const devOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200'];
  const prodOrigins = ['https://criminalidade.yudi.com.br'];
  const allowedOrigins = parseAllowedOrigins(
    process.env.ALLOWED_ORIGINS,
    isProduction ? prodOrigins : devOrigins
  );

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logLevels,
  });
  app.enableShutdownHooks();
  const trustedProxies = process.env.TRUSTED_PROXY_CIDRS?.split(',').map((value) => value.trim()).filter(Boolean);
  if (trustedProxies?.length) app.set('trust proxy', trustedProxies);

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  if (!isProduction && process.env.SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Mapa de criminalidade API')
      .setDescription('Documentação da API do Mapa de criminalidade')
      .setVersion('null')
      .build();
    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('api', app, document, {});
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
