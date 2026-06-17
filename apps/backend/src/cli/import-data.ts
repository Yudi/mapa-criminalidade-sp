#!/usr/bin/env node
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app/app.module';
import { DataImportService } from '../app/data-import/data-import-orchestrator.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataImportService = app.get(DataImportService);

  console.log('Starting data import...');

  try {
    await dataImportService.importAllData();
    console.log('Data import completed successfully');
  } catch (error) {
    console.error('Data import failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
