import { z } from 'zod';

export const DATA_IMPORT_QUEUE_NAME = 'data-import';

export const DATA_IMPORT_TIME_ZONE = 'America/Sao_Paulo';

export const dataImportJobNameSchema = z.enum([
  'import-all-categories',
  'import-all-data',
  'import-category',
]);

export const dataImportSchedulerIdSchema = z.enum(['daily-data-import']);

export type DataImportJobName = z.infer<typeof dataImportJobNameSchema>;
export type DataImportSchedulerId = z.infer<
  typeof dataImportSchedulerIdSchema
>;
export type DataImportQueueName = DataImportJobName | DataImportSchedulerId;

export const dataImportJobDataSchema = z
  .object({
    requestedAt: z.string().datetime(),
    requestedBy: z.enum(['scheduler', 'manual']),
    reason: z.string().trim().min(1),
    categoryName: z.string().trim().min(1).optional(),
  })
  .strict();

export type DataImportJobData = z.infer<typeof dataImportJobDataSchema>;

export interface DataImportQueueJob {
  id?: string;
  name: DataImportJobName;
}

export const dataImportScheduleDefinitionSchema = z
  .object({
    schedulerId: dataImportSchedulerIdSchema,
    jobName: dataImportJobNameSchema,
    cron: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

export const dataImportScheduleDefinitionsSchema = z
  .array(dataImportScheduleDefinitionSchema)
  .nonempty();

export type DataImportScheduleDefinition = z.infer<
  typeof dataImportScheduleDefinitionSchema
>;
