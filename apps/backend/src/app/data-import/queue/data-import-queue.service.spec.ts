import { Job } from 'bullmq';
import { MapFeaturesEtlService } from '../../map-features/services/map-features-etl.service';
import { DataImportService } from '../data-import-orchestrator.service';
import {
  DataImportJobData,
  DataImportJobResult,
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
          job: Job<DataImportJobData, DataImportJobResult, DataImportQueueName>
        ): Promise<DataImportJobResult>;
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

    const result = await service.processJob({
      id: 'daily-data-import',
      name: 'import-all-categories',
      data: {
        requestedAt: new Date().toISOString(),
        requestedBy: 'scheduler',
        reason: 'daily data import check',
      },
      updateData: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<
      DataImportJobData,
      DataImportJobResult,
      DataImportQueueName
    >);

    expect(dataImportService.importAllCategories).toHaveBeenCalledTimes(1);
    expect(mapFeaturesEtlService.runIncrementalEtl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'completed',
      etlProcessedFeatures: 42,
    });
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
        updateData: jest.fn().mockResolvedValue(undefined),
      } as unknown as Job<
        DataImportJobData,
        DataImportJobResult,
        DataImportQueueName
      >)
    ).rejects.toThrow(
      'Post-import ETL failed: Failed to process dados_criminais_2026: database unavailable'
    );
  });

  it('does not checkpoint raw import when a source group fails', async () => {
    const { service, dataImportService, mapFeaturesEtlService } =
      createService();
    jest
      .mocked(dataImportService.importAllCategories)
      .mockRejectedValue(new Error('one source group failed'));
    const updateData = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.processJob({
        id: 'daily-data-import',
        name: 'import-all-categories',
        data: {
          requestedAt: new Date().toISOString(),
          requestedBy: 'scheduler',
          reason: 'data import check',
        },
        updateData,
      } as unknown as Job<
        DataImportJobData,
        DataImportJobResult,
        DataImportQueueName
      >)
    ).rejects.toThrow('one source group failed');

    expect(updateData).not.toHaveBeenCalled();
    expect(mapFeaturesEtlService.runIncrementalEtl).toHaveBeenCalledTimes(1);
  });

  it('retries only ETL after the raw import stage completed', async () => {
    const { service, dataImportService, mapFeaturesEtlService } =
      createService();

    await service.processJob({
      id: 'daily-data-import',
      name: 'import-all-categories',
      data: {
        requestedAt: new Date().toISOString(),
        requestedBy: 'scheduler',
        reason: 'daily data import check',
        rawImportCompletedAt: '2026-08-23T12:00:00.000Z',
      },
      updateData: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<
      DataImportJobData,
      DataImportJobResult,
      DataImportQueueName
    >);

    expect(dataImportService.importAllCategories).not.toHaveBeenCalled();
    expect(mapFeaturesEtlService.runIncrementalEtl).toHaveBeenCalledTimes(1);
  });

  it('records the generated scheduler execution timestamp', async () => {
    const { service } = createService();
    const updateData = jest.fn().mockResolvedValue(undefined);

    await service.processJob({
      id: 'daily-data-import',
      name: 'import-all-categories',
      timestamp: Date.parse('2026-08-23T03:00:00.000Z'),
      data: {
        requestedAt: '2026-08-01T00:00:00.000Z',
        requestedBy: 'scheduler',
        reason: 'daily data import check',
      },
      updateData,
    } as unknown as Job<
      DataImportJobData,
      DataImportJobResult,
      DataImportQueueName
    >);

    expect(updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedAt: '2026-08-23T03:00:00.000Z',
      })
    );
  });

  it('coalesces an active duplicate manual import', async () => {
    const queue = {
      getJob: jest.fn().mockResolvedValue({
        id: 'manual-import-category-Dados_Criminais',
        getState: jest.fn().mockResolvedValue('active'),
      }),
      add: jest.fn(),
    };
    const service = Object.create(
      DataImportQueueService.prototype
    ) as DataImportQueueService;
    Object.assign(service, { queue, isShuttingDown: false });

    await expect(
      service.enqueueManualImport('Dados Criminais')
    ).resolves.toEqual({
      id: 'manual-import-category-Dados_Criminais',
      name: 'import-category',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
