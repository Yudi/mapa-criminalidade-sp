import { containsCoordinate, intersects } from 'ol/extent';
import { of, throwError } from 'rxjs';
import GeoJSON from 'ol/format/GeoJSON';
import RenderFeature from 'ol/render/Feature';
import VectorTile from 'ol/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import {
  CensusAreaSummary,
  CensusLevel,
  MapFeatureFilterInput,
  occurrencesPer100k,
} from '@mapa-criminalidade/shared-types';
import { censusStoryAreas } from '../components/map/components/census-panel/census.fixtures';

type Reference = Pick<CensusAreaSummary, 'releaseId' | 'level' | 'code'>;

/** Storybook-only data source. Neither GraphQL nor Martin is contacted. */
export class StoryCensusService {
  release() {
    return of({
      id: 'storybook-2022',
      year: 2022,
      municipalityCount: 1,
      neighborhoodCount: 2,
    });
  }
  search(releaseId: string, level: CensusLevel, search: string) {
    const normalize = (text: string) =>
      text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR');
    return of(
      censusStoryAreas.filter(
        (area) =>
          area.releaseId === releaseId &&
          area.level === level &&
          (normalize(area.name).includes(normalize(search.trim())) ||
            area.code === search.trim())
      )
    );
  }
  detail(reference: Reference) {
    const area = this.find(reference);
    return area
      ? of(structuredClone(area))
      : throwError(() => new Error('Área fictícia não encontrada'));
  }
  crimes(reference: Reference, filter: MapFeatureFilterInput) {
    const area = this.find(reference);
    if (!area)
      return throwError(() => new Error('Área fictícia não encontrada'));
    const occurrences =
      filter.categories?.length === 0
        ? 0
        : area.level === 'municipality'
        ? 100
        : 50;
    return of({
      occurrences,
      per100k: occurrencesPer100k(occurrences, area.population),
      after: filter.afterDate ?? '2026-01-01',
      before: filter.beforeDate ?? '2026-08-31',
    });
  }
  tiles(releaseId: string, level: CensusLevel): VectorTileSource {
    const format = new GeoJSON<RenderFeature>({ featureClass: RenderFeature });
    const features = censusStoryAreas
      .filter((area) => area.releaseId === releaseId && area.level === level)
      .flatMap((area) => {
        const [west, south, east, north] = area.bounds;
        return [
          {
            type: 'Feature',
            id: `${area.code}-area`,
            properties: { layer: 'areas', code: area.code, name: area.name },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [west, south],
                  [east, south],
                  [east, north],
                  [west, north],
                  [west, south],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            id: `${area.code}-label`,
            properties: { layer: 'labels', code: area.code, name: area.name },
            geometry: {
              type: 'Point',
              coordinates: [(west + east) / 2, (south + north) / 2],
            },
          },
        ];
      });
    // RenderFeature projection mutates point arrays; parse fresh coordinates per tile.
    const geojson = JSON.stringify({ type: 'FeatureCollection', features });
    return new VectorTileSource({
      format,
      maxZoom: 16,
      cacheSize: 16,
      attributions: 'Censo fictício - Storybook',
      attributionsCollapsible: false,
      url: `storybook://census/${level}/{z}/{x}/{y}`,
      tileLoadFunction: (tile) => {
        if (!(tile instanceof VectorTile)) return;
        tile.setLoader((extent, _resolution, projection) => {
          const projected = format.readFeatures(geojson, {
            featureProjection: projection,
          });
          tile.setFeatures(
            projected.filter((feature) =>
              feature.getType() === 'Point'
                ? containsCoordinate(extent, feature.getFlatCoordinates())
                : intersects(extent, feature.getExtent())
            )
          );
        });
      },
    });
  }
  private find(reference: Reference) {
    return censusStoryAreas.find(
      (area) =>
        area.releaseId === reference.releaseId &&
        area.level === reference.level &&
        area.code === reference.code
    );
  }
}
