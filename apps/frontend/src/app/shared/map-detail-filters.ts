import { MapFeatureDetailFilters } from '@mapa-criminalidade/shared-types';

export const DETAIL_FILTER_LABELS = {
  vehicleBrands: 'Marca de veículo',
  objectTypes: 'Tipo de objeto',
  phoneBrandModels: 'Celular',
  locationTypes: 'Tipo de local',
  weekdays: 'Dia da semana',
} as const;
export type DetailFilterKey = keyof MapFeatureDetailFilters;
export type DetailFilterValue = string | number;

export const WEEKDAY_LABELS = [
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
  'Domingo',
] as const;

export interface DetailFilterEntry {
  key: DetailFilterKey;
  value: DetailFilterValue;
  label: (typeof DETAIL_FILTER_LABELS)[DetailFilterKey];
  displayValue: string;
}

export function detailFilterEntries(
  filters: MapFeatureDetailFilters
): DetailFilterEntry[] {
  return (Object.keys(DETAIL_FILTER_LABELS) as DetailFilterKey[]).flatMap(
    (key) =>
      (filters[key] ?? []).map((value) => ({
        key,
        value,
        label: DETAIL_FILTER_LABELS[key],
        displayValue:
          key === 'weekdays' && typeof value === 'number'
            ? WEEKDAY_LABELS[value - 1] ?? String(value)
            : String(value),
      }))
  );
}
