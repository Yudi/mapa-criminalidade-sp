import type { AnalysisArea } from './map-features';

export const ANALYSIS_AREA_LIMITS = {
  maxVertices: 100,
  maxPolygonBytes: 20000,
  maxBoundingBoxKm2: 10000,
  maxSpanKm: 200,
  maxRadiusMeters: 10000,
} as const;

type Position = [number, number];

/** Reject malformed, degenerate and self-intersecting rings before PostGIS. */
export function isValidAnalysisArea(area: AnalysisArea): boolean {
  if (area.polygon == null) {
    return (
      validPosition([area.longitude, area.latitude]) &&
      typeof area.radius === 'number' &&
      Number.isFinite(area.radius) &&
      area.radius >= 1 &&
      area.radius <= ANALYSIS_AREA_LIMITS.maxRadiusMeters
    );
  }
  if (
    area.longitude != null ||
    area.latitude != null ||
    area.radius != null ||
    typeof area.polygon !== 'string' ||
    area.polygon.length > ANALYSIS_AREA_LIMITS.maxPolygonBytes ||
    new TextEncoder().encode(area.polygon).length >
      ANALYSIS_AREA_LIMITS.maxPolygonBytes
  )
    return false;
  let polygon: unknown;
  try {
    polygon = JSON.parse(area.polygon);
  } catch {
    return false;
  }
  if (
    !polygon ||
    typeof polygon !== 'object' ||
    !('type' in polygon) ||
    polygon.type !== 'Polygon' ||
    !('coordinates' in polygon)
  )
    return false;
  const rings = polygon.coordinates;
  if (!Array.isArray(rings) || rings.length !== 1) return false;
  const ring: unknown = rings[0];
  if (
    !Array.isArray(ring) ||
    ring.length < 4 ||
    ring.length > ANALYSIS_AREA_LIMITS.maxVertices + 1 ||
    !ring.every(validPosition)
  )
    return false;
  const points = ring as Position[];
  const longitudes = points.map(([lon]) => lon);
  const latitudes = points.map(([, lat]) => lat);
  const minLat = Math.min(...latitudes),
    maxLat = Math.max(...latitudes);
  const lonSpan = Math.max(...longitudes) - Math.min(...longitudes);
  const radians = Math.PI / 180;
  const earthRadiusKm = 6371.0088;
  // Bound the index candidate envelope, not just the polygon's surface:
  // a thin diagonal polygon must not force a continent-wide index scan.
  const boxKm2 =
    earthRadiusKm ** 2 *
    lonSpan *
    radians *
    (Math.sin(maxLat * radians) - Math.sin(minLat * radians));
  const northSouthKm = earthRadiusKm * (maxLat - minLat) * radians;
  const closestToEquator =
    minLat <= 0 && maxLat >= 0
      ? 0
      : Math.min(Math.abs(minLat), Math.abs(maxLat));
  const eastWestKm =
    earthRadiusKm * lonSpan * radians * Math.cos(closestToEquator * radians);
  if (
    lonSpan > 180 ||
    boxKm2 > ANALYSIS_AREA_LIMITS.maxBoundingBoxKm2 ||
    Math.max(northSouthKm, eastWestKm) > ANALYSIS_AREA_LIMITS.maxSpanKm
  )
    return false;
  const last = points.length - 1;
  if (!equal(points[0], points[last])) return false;
  let twiceArea = 0;
  for (let i = 0; i < last; i++) {
    const a = points[i],
      b = points[i + 1];
    if (equal(a, b) || Math.abs(a[0] - b[0]) > 180) return false;
    twiceArea += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < last; j++) {
      if (j === i + 1 || (i === 0 && j === last - 1)) continue;
      if (intersects(a, b, points[j], points[j + 1])) return false;
    }
    // Straight-edge clicks are valid; reject only an adjacent reversal.
    const c = points[(i + 2) % last];
    if (
      cross(a, b, c) === 0 &&
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0
    )
      return false;
  }
  return Math.abs(twiceArea) > 1e-12;
}

function validPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
function equal(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function intersects(
  a: Position,
  b: Position,
  c: Position,
  d: Position
): boolean {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false;
  return (
    cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
  );
}
