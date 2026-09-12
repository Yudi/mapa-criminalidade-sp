import { validateAnalysisArea } from './analysis-area.validation';
import {
  AnalysisArea,
  MapFeatureDetailFilters,
} from '@mapa-criminalidade/shared-types';
import { BadRequestException } from '@nestjs/common';
import { ValidatorsService } from '../../shared/validators/validators.service';
import { MapFeaturesFilterParams } from '../types/map-features.types';
import { normalizeWeekdays } from '../services/query/map-features-query-cache';

type BoundsQuery = {
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
};

type FilterInputLike = MapFeatureDetailFilters & {
  area?: AnalysisArea;
  beforeDate?: string;
  afterDate?: string;
  categories?: string[];
  periods?: string[];
  startHour?: number;
  endHour?: number;
  bounds?: BoundsQuery;
};

type LocationInputLike = {
  longitude: number;
  latitude: number;
  radius: number;
  beforeDate?: string;
  afterDate?: string;
  periods?: string[];
  startHour?: number;
  endHour?: number;
};

type LookupInputLike = {
  numBo?: string;
  anoBo?: number;
  delegacia?: string | null;
};

export type NormalizedLookup = {
  numBo: string;
  anoBo?: number;
  delegacia: string | null;
};

export const MAX_FILTER_LIST_ITEMS = 200;
export const MAX_FILTER_ITEM_LENGTH = 256;
export const MAX_FILTER_DATE_SPAN_DAYS = 30 * 366;
export const MAX_BOUNDS_AREA_DEGREES = 20_000;
export const MAX_NUM_BO_LENGTH = 160;
export const MAX_DELEGACIA_LENGTH = 256;
export const MIN_LOOKUP_YEAR = 1800;
export const MAX_LOOKUP_YEAR = 2200;

function badRequest(message: string): never {
  throw new BadRequestException(message);
}

export function parseIntegerParam(value: unknown, name: string): number {
  if (typeof value !== 'string') badRequest(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    badRequest(`Invalid ${name}`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    badRequest(`Invalid ${name}`);
  }

  return parsed;
}

export function parseOptionalIntegerQuery(
  value: unknown,
  name: string
): number | undefined {
  if (value !== undefined && typeof value !== 'string')
    badRequest(`Invalid ${name}`);
  return value === undefined || value.trim() === ''
    ? undefined
    : parseIntegerParam(value, name);
}

export function parseOptionalHourQuery(
  value: unknown,
  name: string
): number | undefined {
  const parsed = parseOptionalIntegerQuery(value, name);

  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < 0 || parsed > 23) {
    badRequest(`${name} must be between 0 and 23`);
  }

  return parsed;
}

export function parseNumberQuery(value: unknown, name: string): number {
  if (typeof value !== 'string') badRequest(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    badRequest(`Invalid ${name}`);
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    badRequest(`Invalid ${name}`);
  }

  return parsed;
}

export function parseOptionalNumberQuery(
  value: unknown,
  name: string
): number | undefined {
  if (value !== undefined && typeof value !== 'string')
    badRequest(`Invalid ${name}`);
  return value === undefined || value.trim() === ''
    ? undefined
    : parseNumberQuery(value, name);
}

export function parseStringListQuery(
  value: string | string[] | undefined,
  name = 'filter'
): string[] | undefined {
  if (value === undefined) return undefined;

  const values = Array.isArray(value) ? value : [value];
  const parsedValues = values.flatMap((item) => {
    if (typeof item !== 'string') badRequest(`Invalid ${name}`);
    const trimmed = item.trim();
    if (trimmed.startsWith('[')) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(trimmed);
      } catch {
        badRequest(`Invalid ${name}`);
      }

      if (
        !Array.isArray(decoded) ||
        !decoded.every((entry): entry is string => typeof entry === 'string')
      ) {
        badRequest(`Invalid ${name}`);
      }

      return decoded;
    }

    return trimmed.split(',');
  });

  return validateStringList(parsedValues, name);
}

export function parseWeekdayListQuery(
  value: string | string[] | undefined,
  name = 'weekdays'
): number[] | undefined {
  if (value === undefined) return undefined;

  const values = (Array.isArray(value) ? value : [value]).flatMap((item) => {
    if (typeof item !== 'string') badRequest(`Invalid ${name}`);
    const trimmed = item.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(trimmed);
      } catch {
        badRequest(`Invalid ${name}`);
      }

      if (!Array.isArray(decoded)) badRequest(`Invalid ${name}`);
      return decoded;
    }

    return trimmed.split(',');
  });

  if (
    values.some(
      (entry) =>
        (typeof entry !== 'number' && typeof entry !== 'string') ||
        !/^[1-7]$/.test(String(entry).trim())
    )
  ) {
    badRequest(`${name} values must be integers from 1 to 7`);
  }

  return normalizeWeekdays(values.map((entry) => Number(entry)));
}

export function normalizeStringList(values?: string[]): string[] | undefined {
  const normalized = values?.map((value) => value.trim()).filter(Boolean);

  return normalized?.length ? normalized : undefined;
}

export function validateStringList(
  values: string[] | undefined,
  name: string
): string[] | undefined {
  const normalized = normalizeStringList(values);
  if (!normalized) return undefined;

  if (normalized.length > MAX_FILTER_LIST_ITEMS) {
    badRequest(`${name} accepts at most ${MAX_FILTER_LIST_ITEMS} values`);
  }

  if (normalized.some((value) => value.length > MAX_FILTER_ITEM_LENGTH)) {
    badRequest(
      `${name} values must be at most ${MAX_FILTER_ITEM_LENGTH} characters`
    );
  }

  if (normalized.some(containsControlCharacters)) {
    badRequest(`${name} contains invalid characters`);
  }

  return [...new Set(normalized)];
}

export function validateDateFilters(
  validatorsService: ValidatorsService,
  before?: string,
  after?: string
): void {
  if (before && !validatorsService.isDateValid(before)) {
    badRequest('Invalid before date');
  }

  if (after && !validatorsService.isDateValid(after)) {
    badRequest('Invalid after date');
  }

  if (before && after) {
    const spanDays =
      (Date.parse(`${before}T00:00:00.000Z`) -
        Date.parse(`${after}T00:00:00.000Z`)) /
      86_400_000;
    if (spanDays > MAX_FILTER_DATE_SPAN_DAYS) {
      badRequest(`Date range cannot exceed ${MAX_FILTER_DATE_SPAN_DAYS} days`);
    }
  }

  if (before && after && !validatorsService.isBeforeAfterValid(before, after)) {
    badRequest('before date must be on or after after date');
  }
}

export function validateHourFilters(
  startHour?: number,
  endHour?: number
): void {
  for (const [name, hour] of [
    ['startHour', startHour],
    ['endHour', endHour],
  ] as const) {
    if (hour === undefined) {
      continue;
    }

    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      badRequest(`${name} must be an integer from 0 to 23`);
    }
  }

  if (
    (startHour === undefined && endHour !== undefined) ||
    (startHour !== undefined && endHour === undefined)
  ) {
    badRequest('startHour and endHour must be used together');
  }
}

export function parseBoundsQuery(
  validatorsService: ValidatorsService,
  minLon?: string,
  minLat?: string,
  maxLon?: string,
  maxLat?: string
): BoundsQuery {
  const parsed = {
    minLon: parseOptionalNumberQuery(minLon, 'minLon'),
    minLat: parseOptionalNumberQuery(minLat, 'minLat'),
    maxLon: parseOptionalNumberQuery(maxLon, 'maxLon'),
    maxLat: parseOptionalNumberQuery(maxLat, 'maxLat'),
  };

  return validateBounds(validatorsService, parsed);
}

export function parseLocationQuery(
  validatorsService: ValidatorsService,
  lon: string,
  lat: string,
  radius: string
): { lon: number; lat: number; radius: number } {
  const parsedLon = parseNumberQuery(lon, 'lon');
  const parsedLat = parseNumberQuery(lat, 'lat');
  const parsedRadius = parseNumberQuery(radius, 'radius');

  validateLocation(validatorsService, {
    longitude: parsedLon,
    latitude: parsedLat,
    radius: parsedRadius,
  });

  return { lon: parsedLon, lat: parsedLat, radius: parsedRadius };
}

export function validateFilterInput(
  validatorsService: ValidatorsService,
  filter?: FilterInputLike
): void {
  if (!filter) return;
  if (filter.area != null) {
    if (filter.bounds != null) badRequest('Use either area or bounds');
    validateAnalysisArea(filter.area);
  }

  validateDateFilters(validatorsService, filter.beforeDate, filter.afterDate);
  validateHourFilters(filter.startHour, filter.endHour);
  validateStringList(filter.categories, 'categories');
  validateStringList(filter.periods, 'periods');
  validateStringList(filter.vehicleBrands, 'vehicleBrands');
  validateStringList(filter.objectTypes, 'objectTypes');
  validateStringList(filter.phoneBrandModels, 'phoneBrandModels');
  validateStringList(filter.locationTypes, 'locationTypes');
  if (
    filter.weekdays?.some(
      (weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7
    )
  ) {
    badRequest('weekdays values must be integers from 1 to 7');
  }

  if (filter.bounds) {
    validateBounds(validatorsService, filter.bounds);
  }
}

export function validateLocationInput(
  validatorsService: ValidatorsService,
  input: LocationInputLike
): void {
  validateLocation(validatorsService, input);
  validateDateFilters(validatorsService, input.beforeDate, input.afterDate);
  validateHourFilters(input.startHour, input.endHour);
  validateStringList(input.periods, 'periods');
}

export function toQueryParams(
  filter?: FilterInputLike
): MapFeaturesFilterParams {
  return {
    area: filter?.area ?? undefined,
    beforeDate: filter?.beforeDate,
    afterDate: filter?.afterDate,
    categories: normalizeStringList(filter?.categories),
    periods: normalizeStringList(filter?.periods),
    vehicleBrands: normalizeStringList(filter?.vehicleBrands),
    objectTypes: normalizeStringList(filter?.objectTypes),
    phoneBrandModels: normalizeStringList(filter?.phoneBrandModels),
    locationTypes: normalizeStringList(filter?.locationTypes),
    weekdays: normalizeWeekdays(filter?.weekdays),

    startHour: filter?.startHour,
    endHour: filter?.endHour,
    minLon: filter?.bounds?.minLon,
    minLat: filter?.bounds?.minLat,
    maxLon: filter?.bounds?.maxLon,
    maxLat: filter?.bounds?.maxLat,
  };
}

export function normalizeLookup(
  input?: LookupInputLike,
  numBo?: string,
  anoBo?: number,
  delegacia?: string | null
): NormalizedLookup {
  const lookup = {
    numBo: input?.numBo ?? numBo,
    anoBo: input?.anoBo ?? anoBo,
    delegacia: input?.delegacia ?? delegacia,
  };

  if (!lookup.numBo?.trim()) {
    badRequest('numBo is required');
  }

  const normalizedNumBo = lookup.numBo.trim();
  if (
    normalizedNumBo.length > MAX_NUM_BO_LENGTH ||
    containsControlCharacters(normalizedNumBo)
  ) {
    badRequest(`numBo must be at most ${MAX_NUM_BO_LENGTH} characters`);
  }

  if (
    lookup.anoBo !== undefined &&
    (!Number.isSafeInteger(lookup.anoBo) ||
      lookup.anoBo < MIN_LOOKUP_YEAR ||
      lookup.anoBo > MAX_LOOKUP_YEAR)
  ) {
    badRequest(
      `anoBo must be between ${MIN_LOOKUP_YEAR} and ${MAX_LOOKUP_YEAR}`
    );
  }

  const normalizedDelegacia = lookup.delegacia?.trim() || null;
  if (
    normalizedDelegacia &&
    (normalizedDelegacia.length > MAX_DELEGACIA_LENGTH ||
      containsControlCharacters(normalizedDelegacia))
  ) {
    badRequest(`delegacia must be at most ${MAX_DELEGACIA_LENGTH} characters`);
  }

  return {
    numBo: normalizedNumBo,
    anoBo: lookup.anoBo,
    delegacia: normalizedDelegacia,
  };
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validateBounds(
  validatorsService: ValidatorsService,
  bounds: BoundsQuery
): BoundsQuery {
  const values = Object.values(bounds);
  const hasAnyBound = values.some((value) => value !== undefined);
  const hasAllBounds = values.every((value) => value !== undefined);

  if (!hasAnyBound) {
    return {};
  }

  if (!hasAllBounds) {
    badRequest('Bounds require minLon, minLat, maxLon, and maxLat');
  }

  const completeBounds = bounds as Required<BoundsQuery>;
  const boundValues = [
    completeBounds.minLon,
    completeBounds.minLat,
    completeBounds.maxLon,
    completeBounds.maxLat,
  ];
  if (
    !boundValues.every(Number.isFinite) ||
    !validatorsService.isCoordinatesValid(
      completeBounds.minLon,
      completeBounds.minLat
    ) ||
    !validatorsService.isCoordinatesValid(
      completeBounds.maxLon,
      completeBounds.maxLat
    ) ||
    completeBounds.minLon > completeBounds.maxLon ||
    completeBounds.minLat > completeBounds.maxLat
  ) {
    badRequest('Invalid bounds');
  }

  const longitudeSpan = completeBounds.maxLon - completeBounds.minLon;
  const latitudeSpan = completeBounds.maxLat - completeBounds.minLat;
  if (
    longitudeSpan * latitudeSpan > MAX_BOUNDS_AREA_DEGREES ||
    longitudeSpan > 180 ||
    latitudeSpan > 90
  ) {
    badRequest('Bounds cover too large an area');
  }

  return completeBounds;
}

function validateLocation(
  validatorsService: ValidatorsService,
  input: Pick<LocationInputLike, 'longitude' | 'latitude' | 'radius'>
): void {
  if (
    ![input.longitude, input.latitude, input.radius].every(Number.isFinite) ||
    !validatorsService.isCoordinatesValid(input.longitude, input.latitude)
  ) {
    badRequest('Invalid location');
  }

  if (!validatorsService.isRadiusValid(input.radius)) {
    badRequest('Radius must be between 1 and 10000 meters');
  }
}
