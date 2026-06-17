import { z } from 'zod';

export const columnTypeOverridesSchema = z.record(
  z.string().trim().min(1),
  z.string().trim().min(1)
);

export const dataCategorySchema = z
  .object({
    name: z.string().trim().min(1),
    baseUrl: z.string().trim().url(),
    years: z.array(z.number().int().min(2000).max(2100)).nonempty(),
    tablePrefix: z.string().trim().regex(/^[a-z0-9_]+$/),
    hasSchema: z.boolean(),
    importStrategy: z.enum(['direct-xlsx', 'ssp-iml']).optional(),
    useYearSuffix: z.boolean().optional(),
    sheetNamePatterns: z.array(z.string().trim().min(1)).optional(),
    columnTypeOverrides: columnTypeOverridesSchema.optional(),
  })
  .strict();

export const dataCategoriesSchema = z.array(dataCategorySchema).nonempty();
