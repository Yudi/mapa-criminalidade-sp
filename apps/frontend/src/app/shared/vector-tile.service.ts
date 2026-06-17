import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay, take } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  TileMetadata,
  TileFilterParams,
  OccurrenceTileMetadata,
  MapFeaturesMetadataQuery,
} from '@mapa-criminalidade/shared-types';
import { GraphqlClientService } from './graphql-client.service';
import { MAP_FEATURES_METADATA_QUERY } from './map-features.graphql';

const TILE_SCHEMA_VERSION = 'v1';

export type { TileMetadata, TileFilterParams };
export interface ExtendedTileFilterParams extends TileFilterParams {
  categories?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class VectorTileService {
  private graphql = inject(GraphqlClientService);
  private metadataCache$: Observable<OccurrenceTileMetadata> | null = null;
  buildTileUrl(params?: ExtendedTileFilterParams): string {
    const baseUrl =
      environment.tileUrlTemplate ??
      `${environment.apiUrl}/tiles/{z}/{x}/{y}.mvt`;

    const queryParams = [
      `tileSchema=${encodeURIComponent(TILE_SCHEMA_VERSION)}`,
    ];

    if (params?.before) {
      queryParams.push(`before=${encodeURIComponent(params.before)}`);
    }

    if (params?.after) {
      queryParams.push(`after=${encodeURIComponent(params.after)}`);
    }

    // Support both 'categories' (new) and 'rubricas' (legacy)
    const categories = this.normalizeList(
      params?.categories || params?.rubricas
    );
    if (categories && categories.length > 0) {
      queryParams.push(
        `categories=${encodeURIComponent(categories.join(','))}`
      );
    }

    const periods = this.normalizeList(params?.periods);
    if (periods.length > 0) {
      queryParams.push(`periods=${encodeURIComponent(periods.join(','))}`);
    }

    if (params?.startHour !== undefined && params.endHour !== undefined) {
      queryParams.push(`startHour=${params.startHour}`);
      queryParams.push(`endHour=${params.endHour}`);
    }

    return `${baseUrl}?${queryParams.join('&')}`;
  }
  private normalizeList(values?: string[]): string[] {
    return [
      ...new Set(values?.map((value) => value.trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right));
  }
  getMetadata(): Observable<OccurrenceTileMetadata> {
    if (!this.metadataCache$) {
      this.metadataCache$ = this.graphql
        .request<MapFeaturesMetadataQuery>({
          query: MAP_FEATURES_METADATA_QUERY,
        })
        .pipe(
          map((data) => data.mapFeaturesMetadata),
          take(1),
          shareReplay(1)
        );
    }
    return this.metadataCache$;
  }
  clearMetadataCache(): void {
    this.metadataCache$ = null;
  }
}
