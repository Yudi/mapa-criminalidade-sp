import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { OccurrencesService } from '../../../../shared/occurrences.service';
import { FeatureDetailDialogComponent } from './feature-detail-dialog.component';
import { Subject } from 'rxjs';
import type { FeatureDetailProgress } from '../../../../shared/occurrences.service';

describe('FeatureDetailDialogComponent', () => {
  let component: FeatureDetailDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureDetailDialogComponent],
      providers: [
        {
          provide: OccurrencesService,
          useValue: {
            getFullFeature: vi.fn(),
            getFullFeatureProgressive: vi.fn(),
          },
        },
        {
          provide: MatDialogRef,
          useValue: {
            close: vi.fn(),
          },
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            featureId: 'feature-123',
            numBo: '123',
            anoBo: 2026,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FeatureDetailDialogComponent);
    component = fixture.componentInstance;
  });

  it('formats clock occurrence times with a time label', () => {
    expect(component.formatOccurrenceTime('9:05:00')).toBe('09:05');
    expect(component.getOccurrenceTimeLabel('9:05:00')).toBe('às');
  });

  it('formats descriptive occurrence periods without treating them as clock times', () => {
    expect(component.formatOccurrenceTime('DE MADRUGADA')).toBe('de madrugada');
    expect(component.getOccurrenceTimeLabel('DE MADRUGADA')).toBe('Período:');
  });

  it('formats IML entry timestamps without timezone conversion', () => {
    expect(component.formatImlDate('01/02/2026 09:05:00')).toBe(
      '01/02/2026 às 09:05'
    );
  });

  it('shows the overview while IML data is still loading', () => {
    const progress = new Subject<FeatureDetailProgress>();
    const service = TestBed.inject(OccurrencesService);
    vi.mocked(service.getFullFeatureProgressive).mockReturnValue(progress);
    component.ngOnInit();
    const feature = {
      dataOcorrencia: '2026-09-28',
      featureData: { location: {}, occurrence: {}, all_rubricas: [], records: [] },
      imlRecords: [],
    } as unknown as FeatureDetailProgress['feature'];
    progress.next({ feature, complete: false, imlError: false });
    expect(component.loading()).toBe(false);
    expect(component.imlLoading()).toBe(true);
    progress.next({ feature, complete: true, imlError: false });
    expect(component.imlLoading()).toBe(false);
  });
});
