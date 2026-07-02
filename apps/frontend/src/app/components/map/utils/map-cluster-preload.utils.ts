import OlMap from 'ol/Map';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import TileState from 'ol/TileState';
import type Tile from 'ol/Tile';

import { MAP_INTERACTIVE_LAYER_PROPERTY } from './map-layer.constants';

const CLUSTER_PRELOAD_MAX_WAIT_MS = 300;

export async function preloadNextZoomTiles(
  olMap: OlMap,
  coordinate: [number, number]
): Promise<void> {
  const tileLayer = olMap
    .getLayers()
    .getArray()
    .find(
      (layer): layer is VectorTileLayer =>
        layer instanceof VectorTileLayer &&
        layer.get(MAP_INTERACTIVE_LAYER_PROPERTY) === true
    );
  const source = tileLayer?.getSource();
  const mapSize = olMap.getSize();

  if (!(source instanceof VectorTileSource) || !mapSize) return;

  const view = olMap.getView();
  const currentZoom = view.getZoom() ?? 0;
  const nextZoom = Math.min(Math.ceil(currentZoom + 1), view.getMaxZoom());
  const projection = view.getProjection();
  const resolution = view.getResolutionForZoom(nextZoom);
  const halfWidth = (mapSize[0] * resolution) / 2;
  const halfHeight = (mapSize[1] * resolution) / 2;
  const targetExtent = [
    coordinate[0] - halfWidth,
    coordinate[1] - halfHeight,
    coordinate[0] + halfWidth,
    coordinate[1] + halfHeight,
  ];
  const tileGrid = source.getTileGridForProjection(projection);
  const sourceTiles = new Set<Tile>();

  tileGrid.forEachTileCoord(targetExtent, nextZoom, ([z, x, y]) => {
    const renderTile = source.getTile(
      z,
      x,
      y,
      olMap.getPixelRatio(),
      projection
    );
    renderTile.load();
    renderTile.getSourceTiles().forEach((tile) => sourceTiles.add(tile));
  });

  await waitForTiles([...sourceTiles]);
}

function waitForTiles(tiles: Tile[]): Promise<void> {
  const pendingTiles = new Set(tiles.filter((tile) => !isTileSettled(tile)));
  if (pendingTiles.size === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const listeners = new globalThis.Map<Tile, () => void>();
    const finish = () => {
      clearTimeout(timeout);
      listeners.forEach((listener, tile) =>
        tile.removeEventListener('change', listener)
      );
      resolve();
    };
    const timeout = setTimeout(finish, CLUSTER_PRELOAD_MAX_WAIT_MS);

    pendingTiles.forEach((tile) => {
      const listener = () => {
        if (!isTileSettled(tile)) return;

        tile.removeEventListener('change', listener);
        listeners.delete(tile);
        pendingTiles.delete(tile);

        if (pendingTiles.size === 0) {
          finish();
        }
      };

      listeners.set(tile, listener);
      tile.addEventListener('change', listener);
    });
  });
}

function isTileSettled(tile: Tile): boolean {
  return [TileState.LOADED, TileState.ERROR, TileState.EMPTY].includes(
    tile.getState()
  );
}
