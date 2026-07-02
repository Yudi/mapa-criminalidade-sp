import { createHash } from 'node:crypto';
import { MapFeaturesFilterParams } from '../../types/map-features.types';

export const MAP_FEATURES_CACHE_KEY_PREFIX = 'map-features:v2';

export const MAP_FEATURES_CACHE_TTL_SECONDS = {
  CHARTS: 10 * 60,
  FILTERED_STATS: 5 * 60,
  GLOBAL_METADATA: 30 * 60,
} as const;

export function buildMapFeaturesCacheKey(
  scope: string,
  payload: unknown
): string {
  const serializedPayload = JSON.stringify(normalizeCachePayload(payload));
  const digest = createHash('sha256')
    .update(serializedPayload)
    .digest('base64url');

  return `${MAP_FEATURES_CACHE_KEY_PREFIX}:${scope}:${digest}`;
}

export function normalizeCachePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => normalizeCachePayload(item));

    if (
      normalizedItems.every(
        (item) =>
          item === null ||
          ['boolean', 'number', 'string'].includes(typeof item)
      )
    ) {
      return normalizedItems.sort((left, right) =>
        String(left).localeCompare(String(right))
      );
    }

    return normalizedItems;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && item !== null && item !== '')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .reduce<Record<string, unknown>>((payload, [key, item]) => {
      payload[key] = normalizeCachePayload(item);
      return payload;
    }, {});
}

export function normalizeMapFeaturesFilterParams(
  params?: MapFeaturesFilterParams
): MapFeaturesFilterParams {
  return {
    beforeDate: normalizeOptionalString(params?.beforeDate),
    afterDate: normalizeOptionalString(params?.afterDate),
    categories: normalizeStringList(params?.categories),
    periods: normalizeStringList(params?.periods),
    startHour: params?.startHour,
    endHour: params?.endHour,
    minLon: params?.minLon,
    minLat: params?.minLat,
    maxLon: params?.maxLon,
    maxLat: params?.maxLat,
  };
}

export function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeStringList(values?: string[]): string[] | undefined {
  const normalized = values
    ?.map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return normalized?.length ? normalized : undefined;
}

export function getMapFeaturesStatsCacheTtl(
  params?: MapFeaturesFilterParams
): number {
  const normalized = normalizeCachePayload(
    normalizeMapFeaturesFilterParams(params)
  );
  const hasFilters =
    normalized !== null &&
    typeof normalized === 'object' &&
    Object.keys(normalized).length > 0;

  return hasFilters
    ? MAP_FEATURES_CACHE_TTL_SECONDS.FILTERED_STATS
    : MAP_FEATURES_CACHE_TTL_SECONDS.GLOBAL_METADATA;
}
