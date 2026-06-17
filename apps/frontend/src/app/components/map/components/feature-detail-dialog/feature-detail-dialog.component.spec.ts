import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { OccurrencesService } from '../../../../shared/occurrences.service';
import { FeatureDetailDialogComponent } from './feature-detail-dialog.component';

describe('FeatureDetailDialogComponent', () => {
  let component: FeatureDetailDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureDetailDialogComponent],
      providers: [
        {
          provide: OccurrencesService,
          useValue: {
            getFullFeature: jest.fn(),
          },
        },
        {
          provide: MatDialogRef,
          useValue: {
            close: jest.fn(),
          },
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
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
});
