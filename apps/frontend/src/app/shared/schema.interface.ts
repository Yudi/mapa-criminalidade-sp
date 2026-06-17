export type {
  BoletimOcorrencia,
  DataFormValues,
  ListRubricasForPointResponse,
  LocationQueryParams,
  RubricaQueryParams,
  GeometryPoint,
  TileMetadata,
  TileFilterParams,
} from '@mapa-criminalidade/shared-types';

import { Geometry } from 'ol/geom';
import { BoletimOcorrencia as SharedBoletimOcorrencia } from '@mapa-criminalidade/shared-types';

export interface BoletimOcorrenciaWithOlGeometry
  extends Omit<SharedBoletimOcorrencia, 'location'> {
  location: Geometry | null;
}
