const SPREAD_RADIUS_PX = 38;
const SPREAD_RING_GAP_PX = 30;

export const SPREAD_MARKER_PROPERTY = 'spreadMarker';
export const SPREAD_ANIMATION_MS = 220;

export function getSpreadPixelOffsets(count: number): [number, number][] {
  const offsets: [number, number][] = [];
  let remaining = count;
  let placed = 0;
  let ring = 1;

  while (remaining > 0) {
    const capacity = ring === 1 ? 8 : ring * 12;
    const markersInRing = Math.min(remaining, capacity);
    const radius = SPREAD_RADIUS_PX + (ring - 1) * SPREAD_RING_GAP_PX;
    const angleOffset = ring % 2 === 0 ? Math.PI / markersInRing : 0;

    for (let index = 0; index < markersInRing; index++) {
      const angle =
        (2 * Math.PI * index) / markersInRing - Math.PI / 2 + angleOffset;
      offsets[placed + index] = [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ];
    }

    placed += markersInRing;
    remaining -= markersInRing;
    ring++;
  }

  return offsets;
}
