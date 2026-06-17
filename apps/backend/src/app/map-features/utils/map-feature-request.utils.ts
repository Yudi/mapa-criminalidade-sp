import { BadRequestException } from '@nestjs/common';
import { ValidatorsService } from '../../shared/validators/validators.service';
import { MapFeaturesFilterParams } from '../types/map-features.types';

type BoundsQuery = {
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
};

type FilterInputLike = {
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

function badRequest(message: string): never {
  throw new BadRequestException(message);
}

export function parseIntegerParam(value: string, name: string): number {
  const trimmed = value?.trim();
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
  value: string | undefined,
  name: string
): number | undefined {
  return value === undefined || value.trim() === ''
    ? undefined
    : parseIntegerParam(value, name);
}

export function parseOptionalHourQuery(
  value: string | undefined,
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

export function parseNumberQuery(value: string, name: string): number {
  const trimmed = value?.trim();
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
  value: string | undefined,
  name: string
): number | undefined {
  return value === undefined || value.trim() === ''
    ? undefined
    : parseNumberQuery(value, name);
}

export function parseStringListQuery(
  value: string | undefined
): string[] | undefined {
  return normalizeStringList(value?.split(','));
}

export function normalizeStringList(values?: string[]): string[] | undefined {
  const normalized = values
    ?.map((value) => value.trim())
    .filter(Boolean);

  return normalized?.length ? normalized : undefined;
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

  if (
    before &&
    after &&
    !validatorsService.isBeforeAfterValid(before, after)
  ) {
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

  validateDateFilters(validatorsService, filter.beforeDate, filter.afterDate);
  validateHourFilters(filter.startHour, filter.endHour);

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
}

export function toQueryParams(
  filter?: FilterInputLike
): MapFeaturesFilterParams {
  return {
    beforeDate: filter?.beforeDate,
    afterDate: filter?.afterDate,
    categories: normalizeStringList(filter?.categories),
    periods: normalizeStringList(filter?.periods),
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

  return {
    numBo: lookup.numBo.trim(),
    anoBo: lookup.anoBo,
    delegacia: lookup.delegacia?.trim() || null,
  };
}

function validateBounds(
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
