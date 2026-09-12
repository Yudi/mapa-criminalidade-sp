export const MIN_CRIME_TILE_ZOOM = 10;
export const MAX_CRIME_TILE_ZOOM = 22;

export type MapDisplayMode = 'auto' | 'markers' | 'density' | 'heatmap';
// Fixed EPSG:3857 edge length, independent of tile coordinates and zoom.
export const DENSITY_HEXAGON_EDGE_METERS = 500;
