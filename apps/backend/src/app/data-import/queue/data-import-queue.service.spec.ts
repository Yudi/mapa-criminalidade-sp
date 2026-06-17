import { Job } from 'bullmq';
import { MapFeaturesEtlService } from '../../map-features/services/map-features-etl.service';
import { DataImportService } from '../data-import-orchestrator.service';
import {
  DataImportJobData,
  DataImportQueueName,
} from './data-import-queue.types';
import { DataImportQueueService } from './data-import-queue.service';

describe('DataImportQueueService', () => {
  function createService(etlErrors: string[] = []) {
    const dataImportService = {
      importAllCategories: jest.fn().mockResolvedValue(undefined),
    };
    const mapFeaturesEtlService = {
      runIncrementalEtl: jest.fn().mockResolvedValue({
        processed: 42,
        errors: etlErrors,
      }),
    };
    const service = Object.create(
      DataImportQueueService.prototype
    ) as DataImportQueueService;

    Object.assign(service, {
      dataImportService,
      mapFeaturesEtlService,
      logger: {
        log: jest.fn(),
        warn: jest.fn(),
      },
    });

    return {
      service: service as unknown as {
        processJob(
          job: Job<DataImportJobData, void, DataImportQueueName>
        ): Promise<void>;
      },
      dataImportService: dataImportService as unknown as Pick<
        DataImportService,
        'importAllCategories'
      >,
      mapFeaturesEtlService: mapFeaturesEtlService as unknown as Pick<
        MapFeaturesEtlService,
        'runIncrementalEtl'
      >,
    };
  }

  it('runs incremental map ETL immediately after the nightly import', async () => {
    const { service, dataImportService, mapFeaturesEtlService } =
      createService();

    await service.processJob({
      id: 'daily-data-import',
      name: 'import-all-categories',
      data: {
        requestedAt: new Date().toISOString(),
        requestedBy: 'scheduler',
        reason: 'daily data import check',
      },
    } as Job<DataImportJobData, void, DataImportQueueName>);

    expect(dataImportService.importAllCategories).toHaveBeenCalledTimes(1);
    expect(mapFeaturesEtlService.runIncrementalEtl).toHaveBeenCalledTimes(1);
  });

  it('fails the import job when post-import map ETL reports errors', async () => {
    const { service } = createService([
      'Failed to process dados_criminais_2026: database unavailable',
    ]);

    await expect(
      service.processJob({
        id: 'daily-data-import',
        name: 'import-all-categories',
        data: {
          requestedAt: new Date().toISOString(),
          requestedBy: 'scheduler',
          reason: 'daily data import check',
        },
      } as Job<DataImportJobData, void, DataImportQueueName>)
    ).rejects.toThrow(
      'Post-import ETL failed: Failed to process dados_criminais_2026: database unavailable'
    );
  });
});
