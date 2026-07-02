import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export type DatabaseExecutor = PrismaService | Prisma.TransactionClient;

export const ETL_STAGING_TABLE = '"map_features_etl_stage"';

export const ETL_STAGING_SORT_COLUMNS = [
  '"__etl_sort_num_bo"',
  '"__etl_sort_ano_bo"',
  '"__etl_sort_delegacia"',
  '"__etl_sort_latitude_bucket"',
  '"__etl_sort_longitude_bucket"',
  'id',
] as const;

export const MAP_FEATURES_ETL_TRANSACTION_CONFIG = {
  MAX_WAIT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_TRANSACTION_MAX_WAIT_MS',
    30_000,
    1_000,
    120_000
  ),
  TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_TRANSACTION_TIMEOUT_MS',
    3_900_000,
    300_000,
    7_200_000
  ),
  LOCK_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_LOCK_TIMEOUT_MS',
    15_000,
    1_000,
    120_000
  ),
  STATEMENT_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_STATEMENT_TIMEOUT_MS',
    600_000,
    60_000,
    3_900_000
  ),
  IDLE_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_IDLE_TRANSACTION_TIMEOUT_MS',
    120_000,
    30_000,
    600_000
  ),
} as const;

export function getMapFeaturesEtlBatchSize(): number {
  const configured = Number(process.env.MAP_FEATURES_ETL_BATCH_SIZE ?? 2000);
  return Number.isInteger(configured) && configured >= 100 && configured <= 5000
    ? configured
    : 2000;
}

function getPositiveIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min) {
    return fallback;
  }

  return Math.min(value, max);
}
