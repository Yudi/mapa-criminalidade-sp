import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

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
  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });
  app.enableShutdownHooks();

  const devOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200'];
  const prodOrigins = ['https://criminalidade.yudi.com.br'];
  const allowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(',') ||
    (process.env.NODE_ENV === 'production' ? prodOrigins : devOrigins);

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const config = new DocumentBuilder()
    .setTitle('Mapa de criminalidade API')
    .setDescription('Documentação da API do Mapa de criminalidade')
    .setVersion('null')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document, {});

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
