import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { ptBR } from 'date-fns/locale';

import { CardComponent } from './card.component';
import { DateService } from '../../shared/date.service';
import { CategoryInfo, PeriodInfo } from '@mapa-criminalidade/shared-types';

describe('CardComponent', () => {
  let component: CardComponent;
  let fixture: ComponentFixture<CardComponent>;
  let dateService: DateService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardComponent],
      providers: [
        provideDateFnsAdapter(),
        { provide: MAT_DATE_LOCALE, useValue: ptBR },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CardComponent);
    component = fixture.componentInstance;
    dateService = TestBed.inject(DateService);
    fixture.componentRef.setInput('rubricas', of([]));
    fixture.componentRef.setInput('periods', of([]));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not select rubricas when they are loaded', () => {
    const emissions: { [key: string]: boolean }[] = [];
    const rubricas: CategoryInfo[] = [
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
      {
        name: 'Roubo',
        count: 5,
        rubricaForStyling: 'Roubo',
        sourceType: 'rubrica',
      },
    ];

    component.rubricasFormEvent.subscribe((value) => emissions.push(value));

    fixture.componentRef.setInput('rubricas', of(rubricas));
    fixture.detectChanges();

    expect(component.rubricasForm.getRawValue()).toEqual({
      Furto: false,
      Roubo: false,
    });
    expect(emissions.at(-1)).toEqual({
      Furto: false,
      Roubo: false,
    });
  });

  it('selects new rubricas while select-all mode remains active', () => {
    const rubricas = new Subject<CategoryInfo[]>();
    fixture.componentRef.setInput('rubricas', rubricas);
    fixture.detectChanges();

    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
    ]);
    component.selectAllRubricas();
    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
      {
        name: 'Roubo',
        count: 5,
        rubricaForStyling: 'Roubo',
        sourceType: 'rubrica',
      },
    ]);

    expect(component.rubricasForm.getRawValue()).toEqual({
      Furto: true,
      Roubo: true,
    });
  });

  it('stops selecting new rubricas after an individual selection changes', () => {
    const rubricas = new Subject<CategoryInfo[]>();
    fixture.componentRef.setInput('rubricas', rubricas);
    fixture.detectChanges();

    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
    ]);
    component.selectAllRubricas();
    component.rubricasForm.get('Furto')?.setValue(false);
    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
      {
        name: 'Roubo',
        count: 5,
        rubricaForStyling: 'Roubo',
        sourceType: 'rubrica',
      },
    ]);

    expect(component.rubricasForm.getRawValue()).toEqual({
      Furto: false,
      Roubo: false,
    });
  });

  it('unselects all rubricas and disables select-all mode', () => {
    const rubricas = new Subject<CategoryInfo[]>();
    fixture.componentRef.setInput('rubricas', rubricas);
    fixture.detectChanges();

    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
    ]);
    component.selectAllRubricas();
    component.unselectAllRubricas();
    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
      {
        name: 'Roubo',
        count: 5,
        rubricaForStyling: 'Roubo',
        sourceType: 'rubrica',
      },
    ]);

    expect(component.rubricasForm.getRawValue()).toEqual({
      Furto: false,
      Roubo: false,
    });
  });

  it('preserves a selected rubrica that has no results in the new viewport', () => {
    const rubricas = new Subject<CategoryInfo[]>();
    fixture.componentRef.setInput('rubricas', rubricas);
    fixture.detectChanges();

    rubricas.next([
      {
        name: 'Furto',
        count: 10,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
    ]);
    component.rubricasForm.get('Furto')?.setValue(true);
    rubricas.next([
      {
        name: 'Roubo',
        count: 5,
        rubricaForStyling: 'Roubo',
        sourceType: 'rubrica',
      },
    ]);

    expect(component.rubricasForm.getRawValue()).toEqual({
      Furto: true,
      Roubo: false,
    });
    expect(component.displayedRubricas()).toEqual([
      {
        name: 'Roubo',
        count: 5,
        rubricaForStyling: 'Roubo',
        sourceType: 'rubrica',
      },
      {
        name: 'Furto',
        count: 0,
        rubricaForStyling: 'Furto',
        sourceType: 'rubrica',
      },
    ]);

    component.rubricasForm.get('Furto')?.setValue(false);

    expect(component.rubricasForm.contains('Furto')).toBe(false);
    expect(component.displayedRubricas().map((rubrica) => rubrica.name)).toEqual([
      'Roubo',
    ]);
  });

  it('preserves a selected period that has no results in the new viewport', () => {
    const periods = new Subject<PeriodInfo[]>();
    fixture.componentRef.setInput('periods', periods);
    fixture.detectChanges();

    periods.next([{ name: 'Pela manhã', count: 10 }]);
    component.periodControl.setValue('Pela manhã');
    periods.next([{ name: 'À noite', count: 5 }]);

    expect(component.periodControl.value).toBe('Pela manhã');
    expect(component.displayedPeriods()).toEqual([
      { name: 'À noite', count: 5 },
      { name: 'Pela manhã', count: 0 },
    ]);
  });

  it('uses the cached default start date', () => {
    fixture.componentRef.setInput('dateRange', {
      earliest: '2013-01-01',
      latest: '2026-04-30',
      defaultAfter: '2026-01-30',
    });
    fixture.detectChanges();

    expect(
      dateService.formatYYYYMMDD(component.dataForm.controls.afterDate.value)
    ).toBe('2026-01-30');
    expect(
      dateService.formatYYYYMMDD(component.dataForm.controls.beforeDate.value)
    ).toBe('2026-04-30');
  });

  it('does not default before the earliest available date', () => {
    fixture.componentRef.setInput('dateRange', {
      earliest: '2013-01-01',
      latest: '2013-02-01',
      defaultAfter: '2013-01-01',
    });
    fixture.detectChanges();

    expect(
      dateService.formatYYYYMMDD(component.dataForm.controls.afterDate.value)
    ).toBe('2013-01-01');
  });

  it('submits the lookup from the dedicated address button', () => {
    const submitSpy = vi.spyOn(component.submitEvent, 'emit');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.address-lookup__submit'
    );

    button.click();

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['street', 'city', 'state'])(
    'submits the lookup when Enter is pressed in the %s input',
    (controlName) => {
      const submitSpy = vi.spyOn(component.submitEvent, 'emit');
      const input: HTMLInputElement = fixture.nativeElement.querySelector(
        `input[formControlName="${controlName}"]`
      );
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(submitSpy).toHaveBeenCalledTimes(1);
    }
  );

  it('does not submit when Enter is pressed in a date input', () => {
    const submitSpy = vi.spyOn(component.submitEvent, 'emit');
    const dateInput: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[formControlName="afterDate"]'
    );

    dateInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );

    expect(submitSpy).not.toHaveBeenCalled();
  });
});
