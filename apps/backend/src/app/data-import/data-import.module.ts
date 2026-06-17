import { Module } from '@nestjs/common';

import { DataImportController } from './data-import.controller';

import { FileOperationsService } from './services/file-operations.service';
import { RustToolService } from './services/rust-tool.service';
import { DatabaseService } from './services/database.service';
import { MetadataService } from './services/metadata.service';
import { CsvProcessingService } from './services/csv-processing.service';
import { CsvTransformationService } from './services/csv-transformation.service';
import { ParquetProcessingService } from './services/parquet-processing.service';
import { ImportDecisionService } from './services/import-decision.service';
import { ImportStatusService } from './services/import-status.service';
import { DevelopmentOnlyGuard } from '../shared/guards/development-only.guard';
import { DataImportQueueService } from './queue/data-import-queue.service';
import { PythonToolService } from './services/python-tool.service';
import { ImlImportService } from './services/iml-import.service';
import { MapFeaturesModule } from '../map-features/map-features.module';

import { DataImportService } from './data-import-orchestrator.service';

@Module({
  imports: [MapFeaturesModule],
  controllers: [DataImportController],
  providers: [
    FileOperationsService,
    RustToolService,
    DatabaseService,
    MetadataService,
    CsvProcessingService,
    CsvTransformationService,
    ParquetProcessingService,
    ImportDecisionService,
    ImportStatusService,
    PythonToolService,
    ImlImportService,
    DataImportService,
    DataImportQueueService,
    DevelopmentOnlyGuard,
  ],
  exports: [
    DataImportService,
    DataImportQueueService,
  ],
})
export class DataImportModule {}
