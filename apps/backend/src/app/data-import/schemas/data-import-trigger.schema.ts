import { z } from 'zod';

export const dataImportTriggerBodySchema = z
  .object({
    category: z.string().trim().min(1).optional(),
  })
  .strict();

export type DataImportTriggerBody = z.infer<typeof dataImportTriggerBodySchema>;

