import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import {
  MapFeatureCharts,
  MapFeatureFilterInput,
} from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../../../shared/occurrences.service';
import { VisibleMapChartsDialogComponent } from './visible-map-charts-dialog.component';

const charts: MapFeatureCharts = {
  totalFeatures: 3,
  totalRecords: 4,
  categoryDistribution: [
    { label: 'Furto', count: 2 },
    { label: 'Roubo', count: 1 },
  ],
  periodDistribution: [],
  weekdayDistribution: [
    { label: 'Segunda', filterValue: '1', count: 2 },
    { label: 'Terça', filterValue: '2', count: 1 },
  ],
  weekdayHourDistribution: [],
  recordTypeDistribution: [],
  objectTypeDistribution: [
    { label: 'Celular', filterValue: 'Celular', count: 2 },
  ],
  vehicleBrandDistribution: [{ label: 'VW', filterValue: 'VW', count: 1 }],
  phoneBrandDistribution: [
    { label: 'Samsung - Galaxy', filterValue: 'Samsung - Galaxy', count: 1 },
  ],
  locationTypeDistribution: [],
  policeCircumscriptionDistribution: [],
  policeUnitDistribution: [],
  weaponTypeDistribution: [],
  drugTypeDistribution: [],
};

describe('chart drilldown', () => {
  const filter: MapFeatureFilterInput = {
    categories: ['Furto', 'Roubo'],
    afterDate: '2026-01-01',
    periods: ['À noite'],
    area: { longitude: -46.6, latitude: -23.5, radius: 500 },
  };
  const close = vi.fn();
  const getChartsForBounds = vi.fn(() => of(charts));

  beforeEach(() => {
    close.mockReset();
    getChartsForBounds.mockReset().mockReturnValue(of(charts));
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { filter, zoom: 12 } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: OccurrencesService, useValue: { getChartsForBounds } },
      ],
    });
  });

  it('narrows multiple selected rubricas and applies details while preserving the spatial and temporal scope', () => {
    const component = TestBed.createComponent(
      VisibleMapChartsDialogComponent
    ).componentInstance;
    component.ngOnInit();
    component.selectBucket({ key: 'categories', value: 'Furto' });
    component.selectBucket({ key: 'objectTypes', value: 'Celular' });
    expect(getChartsForBounds).toHaveBeenCalledWith({
      ...filter,
      categories: ['Furto'],
      objectTypes: ['Celular'],
    });
    expect(filter.categories).toEqual(['Furto', 'Roubo']);
    expect(close).not.toHaveBeenCalled();
    component.apply();
    expect(close).toHaveBeenCalledWith({
      ...filter,
      categories: ['Furto'],
      objectTypes: ['Celular'],
    });
  });

  it('clears a detail independently and can restore the initial rubricas', () => {
    const component = TestBed.createComponent(
      VisibleMapChartsDialogComponent
    ).componentInstance;
    component.selectBucket({ key: 'categories', value: 'Furto' });
    component.selectBucket({ key: 'vehicleBrands', value: 'VW' });
    component.selectBucket({ key: 'objectTypes', value: 'Celular' });
    component.clearDetail('vehicleBrands', 'VW');
    expect(component.filter()).toMatchObject({
      categories: ['Furto'],
      objectTypes: ['Celular'],
      vehicleBrands: undefined,
    });
    component.resetCategories();
    expect(component.filter().categories).toEqual(filter.categories);
    component.close();
    expect(close).toHaveBeenCalledWith();
  });

  it('toggles multiple values in one topic and keeps a self-excluded facet request', () => {
    const component = TestBed.createComponent(
      VisibleMapChartsDialogComponent
    ).componentInstance;
    component.ngOnInit();
    component.selectBucket({ key: 'weekdays', value: 1 });
    component.selectBucket({ key: 'weekdays', value: 2 });
    component.selectBucket({
      key: 'phoneBrandModels',
      value: 'Samsung - Galaxy',
    });

    expect(component.filter()).toMatchObject({
      weekdays: [1, 2],
      phoneBrandModels: ['Samsung - Galaxy'],
    });
    expect(getChartsForBounds).toHaveBeenCalledWith({
      ...filter,
      weekdays: undefined,
      phoneBrandModels: ['Samsung - Galaxy'],
    });

    component.selectBucket({ key: 'weekdays', value: 1 });
    expect(component.filter().weekdays).toEqual([2]);
  });

  it('ignores stale chart responses after the scope changes', () => {
    const oldRequest = new Subject<MapFeatureCharts>();
    const latestRequest = new Subject<MapFeatureCharts>();
    getChartsForBounds
      .mockReturnValueOnce(oldRequest)
      .mockReturnValueOnce(latestRequest);
    const component = TestBed.createComponent(
      VisibleMapChartsDialogComponent
    ).componentInstance;
    component.ngOnInit();
    component.selectBucket({ key: 'objectTypes', value: 'Celular' });
    oldRequest.next({ ...charts, totalFeatures: 999 });
    expect(component.charts()).toBeNull();
    latestRequest.next(charts);
    expect(component.charts()?.totalFeatures).toBe(3);
  });
});
