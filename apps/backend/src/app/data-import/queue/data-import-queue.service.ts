import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { DataImportService } from '../data-import-orchestrator.service';
import { DataCategory } from '../types/data-import.types';
import { MapFeaturesEtlService } from '../../map-features/services/map-features-etl.service';
import {
  getDataImportQueueConnectionOptions,
  getDataImportWorkerConcurrency,
} from './data-import-queue.config';
import {
  DATA_IMPORT_QUEUE_NAME,
  DATA_IMPORT_TIME_ZONE,
  DataImportJobData,
  DataImportJobResult,
  DataImportJobName,
  DataImportQueueName,
  DataImportQueueJob,
  DataImportScheduleDefinition,
  dataImportJobDataSchema,
  dataImportJobNameSchema,
  dataImportScheduleDefinitionsSchema,
} from './data-import-queue.types';

const REMOVED_SCHEDULER_IDS = [
  'weekly-data-maintenance',
  'periodic-data-consistency-check',
  'monthly-historical-data-check',
  'mid-month-data-verification',
] as const;

@Injectable()
export class DataImportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataImportQueueService.name);
  private readonly queue = new Queue<
    DataImportJobData,
    DataImportJobResult,
    DataImportQueueName
  >(DATA_IMPORT_QUEUE_NAME, {
    connection: getDataImportQueueConnectionOptions(3),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60_000,
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 20,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 50,
      },
    },
  });
  private worker?: Worker<
    DataImportJobData,
    DataImportJobResult,
    DataImportQueueName
  >;
  private isShuttingDown = false;

  private readonly schedules: DataImportScheduleDefinition[] =
    dataImportScheduleDefinitionsSchema.parse([
      {
        schedulerId: 'daily-data-import',
        jobName: 'import-all-categories',
        cron: '0 3 * * *',
        reason: 'daily data import check',
      },
    ]);

  constructor(
    private readonly dataImportService: DataImportService,
    private readonly mapFeaturesEtlService: MapFeaturesEtlService
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<
      DataImportJobData,
      DataImportJobResult,
      DataImportQueueName
    >(
      DATA_IMPORT_QUEUE_NAME,
      (job) => this.processJob(job),
      {
        connection: getDataImportQueueConnectionOptions(null),
        concurrency: getDataImportWorkerConcurrency(),
        lockDuration: 30 * 60 * 1000,
        maxStalledCount: 1,
        stalledInterval: 5 * 60 * 1000,
      }
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Data import job completed: ${job.name} (${job.id})`);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Data import job failed: ${job?.name ?? 'unknown'} (${job?.id})`,
        error
      );
    });

    this.worker.on('error', (error) => {
      this.logger.error('Data import worker error:', error);
    });

    this.queue.on('error', (error) => {
      this.logger.error('Data import queue error:', error);
    });

    await this.queue.setGlobalConcurrency(1);
    await this.registerSchedules();
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    const worker = this.worker;
    if (worker) {
      await worker.pause(true);
      const timeoutMs = this.getShutdownTimeoutMs();
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
        timeoutHandle.unref?.();
      });
      const result = await Promise.race([
        worker.close(false).then(() => 'closed' as const),
        timedOut,
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (result === 'timeout') {
        this.logger.warn(
          `Data import worker did not stop within ${timeoutMs}ms; forcing shutdown`
        );
        worker.disconnect();
        await worker.close(true).catch(() => undefined);
      }
    }
    await this.queue.close();
  }

  async enqueueManualImport(categoryName?: string): Promise<DataImportQueueJob> {
    if (this.isShuttingDown) {
      throw new Error('Data import queue is shutting down');
    }

    const name: DataImportJobName = categoryName
      ? 'import-category'
      : 'import-all-data';
    const data = dataImportJobDataSchema.parse({
      requestedAt: new Date().toISOString(),
      requestedBy: 'manual',
      reason: categoryName ? 'manual category import' : 'manual full import',
      categoryName,
    });
    const jobId = this.getManualJobId(name, categoryName);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(
          state
        )
      ) {
        return { id: existing.id, name };
      }
      await existing.remove().catch(() => undefined);
    }

    const job = await this.queue.add(name, data, { jobId });

    return {
      id: job.id,
      name,
    };
  }

  private async registerSchedules(): Promise<void> {
    for (const schedulerId of REMOVED_SCHEDULER_IDS) {
      if (await this.queue.removeJobScheduler(schedulerId)) {
        this.logger.log(
          `Removed redundant data import schedule: ${schedulerId}`
        );
      }
    }

    for (const schedule of this.schedules) {
      await this.queue.upsertJobScheduler(
        schedule.schedulerId,
        {
          pattern: schedule.cron,
          tz: DATA_IMPORT_TIME_ZONE,
        },
        {
          name: schedule.jobName,
          data: dataImportJobDataSchema.parse({
            requestedAt: new Date().toISOString(),
            requestedBy: 'scheduler',
            reason: schedule.reason,
          }),
          opts: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 60_000,
            },
            removeOnComplete: {
              age: 24 * 60 * 60,
              count: 20,
            },
            removeOnFail: {
              age: 7 * 24 * 60 * 60,
              count: 50,
            },
          },
        }
      );
    }

    this.logger.log(
      `Registered ${this.schedules.length} BullMQ data import schedules`
    );
  }

  private async processJob(
    job: Job<DataImportJobData, DataImportJobResult, DataImportQueueName>
  ): Promise<DataImportJobResult> {
    const jobName = dataImportJobNameSchema.parse(job.name);
    const parsedJobData = dataImportJobDataSchema.parse(job.data);
    const jobData: DataImportJobData = {
      ...parsedJobData,
      requestedAt:
        parsedJobData.requestedBy === 'scheduler'
          ? new Date(job.timestamp ?? Date.now()).toISOString()
          : parsedJobData.requestedAt,
    };

    this.logger.log(
      `Processing data import job ${jobName} (${job.id}): ${jobData.reason}`
    );

    let rawImportCompletedAt = jobData.rawImportCompletedAt;
    if (!rawImportCompletedAt) {
      await this.runRawImportStage(jobName, jobData);
      rawImportCompletedAt = new Date().toISOString();
      await job.updateData({
        ...jobData,
        rawImportCompletedAt,
      });
    } else {
      this.logger.log(
        `Skipping completed raw import stage for retry of ${jobName} (${job.id})`
      );
    }

    const etlResult = await this.mapFeaturesEtlService.runIncrementalEtl();
    this.logger.log(
      `Post-import ETL processed ${etlResult.processed} map features`
    );
    if (etlResult.errors.length > 0) {
      this.logger.warn(
        `Post-import ETL completed with ${etlResult.errors.length} errors`
      );
      throw new Error(
        `Post-import ETL failed: ${etlResult.errors.join('; ')}`
      );
    }

    return {
      status: 'completed',
      rawImportCompletedAt,
      etlCompletedAt: new Date().toISOString(),
      etlProcessedFeatures: etlResult.processed,
    };
  }

  private async runRawImportStage(
    jobName: DataImportJobName,
    jobData: DataImportJobData
  ): Promise<void> {
    switch (jobName) {
      case 'import-all-categories':
        await this.dataImportService.importAllCategories();
        return;
      case 'import-all-data':
        await this.dataImportService.importAllData();
        return;
      case 'import-category':
        await this.importCategory(jobData.categoryName);
        return;
      default:
        throw new Error(`Unsupported data import job: ${jobName}`);
    }
  }

  private async importCategory(categoryName: string | undefined): Promise<void> {
    if (!categoryName) {
      throw new Error('Category name is required');
    }

    const category = this.findCategory(categoryName);
    await this.dataImportService.importDataCategoryWithIntelligentLogic(
      category
    );
  }

  private findCategory(categoryName: string): DataCategory {
    const categories = this.dataImportService.getDataCategories();
    const category = categories.find((item) => item.name === categoryName);

    if (!category) {
      throw new Error(
        `Category "${categoryName}" not found. Available categories: ${categories
          .map((item) => item.name)
          .join(', ')}`
      );
    }

    return category;
  }

  private getManualJobId(
    name: DataImportJobName,
    categoryName?: string
  ): string {
    return `manual-${name}-${categoryName ?? 'all'}`
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 200);
  }

  private getShutdownTimeoutMs(): number {
    const configured = Number(
      process.env.DATA_IMPORT_SHUTDOWN_TIMEOUT_MS ?? 30_000
    );
    return Number.isInteger(configured) && configured >= 1_000
      ? Math.min(configured, 300_000)
      : 30_000;
  }
}
