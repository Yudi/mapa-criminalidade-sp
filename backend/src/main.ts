import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Mapa de criminalidade API')
    .setDescription('Documentação da API do Mapa de criminalidade')
    .setVersion(null)
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document, {});
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
