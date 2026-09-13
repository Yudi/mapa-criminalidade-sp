import { CensusAreaDetail, CensusRelease } from './graphql-projections';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import { environment } from '../../environments/environment';
import { inject, Injectable } from '@angular/core';
import { map } from 'rxjs';
import {
  CensusAreaSummary,
  CensusCrimeStats,
  CensusLevel,
  MapFeatureFilterInput,
} from '@mapa-criminalidade/shared-types';
import { GraphqlClientService } from './graphql-client.service';

@Injectable({ providedIn: 'root' })
export class CensusService {
  private readonly graphql = inject(GraphqlClientService);
  tiles(releaseId: string, level: CensusLevel): VectorTileSource {
    return new VectorTileSource({
      format: new MVT(),
      maxZoom: 16,
      cacheSize: 64,
      url: `${environment.censusTileUrlTemplate}?release=${encodeURIComponent(
        releaseId
      )}&level=${level}`,
    });
  }
  release() {
    return this.graphql
      .request<{ censusRelease: CensusRelease | null }>({
        query:
          'query CensusRelease { censusRelease { id year } }',
      })
      .pipe(map((data) => data.censusRelease));
  }
  search(releaseId: string, level: CensusLevel, search: string) {
    return this.graphql
      .request<{ censusAreas: CensusAreaSummary[] }>({
        query: `query CensusAreas($releaseId: String!, $level: String!, $search: String!) {
        censusAreas(releaseId: $releaseId, level: $level, search: $search) { releaseId level code name municipalityName }
      }`,
        variables: { releaseId, level, search },
      })
      .pipe(map((data) => data.censusAreas));
  }
  detail(area: Pick<CensusAreaSummary, 'releaseId' | 'level' | 'code'>) {
    return this.graphql
      .request<{ censusArea: CensusAreaDetail }>({
        query: `query CensusArea($area: CensusAreaReferenceInput!) {
        censusArea(area: $area) { releaseId level code name municipalityName year population areaKm2 bounds
          indicators { key group label value unit denominator } }
      }`,
        variables: { area },
      })
      .pipe(map((data) => data.censusArea));
  }
  crimes(
    area: Pick<CensusAreaSummary, 'releaseId' | 'level' | 'code'>,
    filter: MapFeatureFilterInput
  ) {
    return this.graphql
      .request<{ censusCrimeStats: CensusCrimeStats }>({
        query: `query CensusCrimeStats($area: CensusAreaReferenceInput!, $filter: MapFeatureFilterInput!) {
        censusCrimeStats(area: $area, filter: $filter) { occurrences per100k after before }
      }`,
        variables: { area, filter },
      })
      .pipe(map((data) => data.censusCrimeStats));
  }
}
