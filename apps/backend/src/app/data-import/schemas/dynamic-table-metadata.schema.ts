import { z } from 'zod';

const columnTypeMapSchema = z.record(
  z.string().trim().min(1),
  z.string().trim().min(1)
);

export const dynamicTableColumnsJsonSchema = z
  .object({
    columns: z.array(z.string().trim().min(1)).nonempty(),
    types: columnTypeMapSchema.optional(),
    logicalTypes: columnTypeMapSchema.optional(),
    originalColumns: z.array(z.string()).optional(),
    processedColumns: z.array(z.string().trim().min(1)).optional(),
    schemaName: z.string().trim().min(1).optional(),
    sourcePath: z.string().trim().min(1).optional(),
    csvPath: z.string().trim().min(1).optional(),
  })
  .passthrough();

export type DynamicTableColumnsJson = z.infer<
  typeof dynamicTableColumnsJsonSchema
>;

