import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnChanges,
  OnInit,
  output,
  signal,
  SimpleChanges,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormRecord,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import DataFormValues from '../../shared/dataForm.interface';
import { Observable, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgOptimizedImage } from '@angular/common';
import {
  CategoryInfo,
  DateRange,
  PeriodInfo,
} from '@mapa-criminalidade/shared-types';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ObjectHandlingService } from '../../shared/object-handling.service';
import { DateService } from '../../shared/date.service';
import { MapMarkersService } from '../../shared/map-markers.service';

type DateControlValue = Date | string | null;
type TimeControlValue = Date | string | null;
type HourFilter = { enabled: boolean; startHour: number; endHour: number };
const ALL_PERIOD_VALUE = '__all_periods__';

@Component({
  selector: 'app-card',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatCheckboxModule,
    ReactiveFormsModule,
    MatInputModule,
    MatSelectModule,
    MatTimepickerModule,
    MatButtonToggleModule,
    MatIconModule,
    NgOptimizedImage,
  ],
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardComponent implements OnChanges, OnInit {
  rubricas = input.required<Observable<CategoryInfo[]>>();
  periods = input.required<Observable<PeriodInfo[]>>();
  dateRange = input<DateRange | null>(null);
  canOpenVisibleCharts = input(false);
  viewportStatsLoading = input(false);

  submitEvent = output<DataFormValues>();
  visibleChartsEvent = output<void>();
  rubricasFormEvent = output<{
    [key: string]: boolean;
  }>();
  periodFilterEvent = output<string | null>();
  hourFilterEvent = output<HourFilter>();

  private objectHandling = inject(ObjectHandlingService);
  private dateService = inject(DateService);
  private markersService = inject(MapMarkersService);

  private formBuilder = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  addressDirty = false;
  dataForm = new FormGroup(
    {
      beforeDate: new FormControl<DateControlValue>(null),
      afterDate: new FormControl<DateControlValue>(null),
      street: new FormControl(''),
      city: new FormControl(''),

      state: new FormControl(
        { value: 'São Paulo', disabled: true },
        Validators.required
      ),
    },
    {
      validators: this.dateService.beforeAfterFormValidator(
        'beforeDate',
        'afterDate'
      ),
    }
  );

  shouldEmitRubricasForm = true;

  rubricasForm = new FormRecord<FormControl<boolean>>({});
  periodControl = new FormControl(ALL_PERIOD_VALUE, { nonNullable: true });
  hourForm = this.formBuilder.group({
    enabled: this.formBuilder.control(false, { nonNullable: true }),
    startTime: this.formBuilder.control<TimeControlValue>(
      this.createTime(8),
      {
        validators: [this.hourOnlyTimeValidator],
      }
    ),
    endTime: this.formBuilder.control<TimeControlValue>(this.createTime(19), {
      validators: [this.hourOnlyTimeValidator],
    }),
  });
  private rubricasSubscription: Subscription | null = null;
  private periodsSubscription: Subscription | null = null;
  private previousRubricas: CategoryInfo[] | null = null;
  private viewportRubricas: CategoryInfo[] = [];
  private rubricaDetails = new Map<string, CategoryInfo>();
  private viewportPeriods: PeriodInfo[] = [];
  private periodDetails = new Map<string, PeriodInfo>();
  private autoSelectNewRubricas = false;
  readonly displayedRubricas = signal<CategoryInfo[]>([]);
  readonly displayedPeriods = signal<PeriodInfo[]>([]);

  minDate: Date | null = null;
  maxDate: Date | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['dateRange']) {
      this.applyDateRange();
    }

    if (changes['rubricas']) {
      if (this.rubricasSubscription) {
        this.rubricasSubscription.unsubscribe();
      }
      this.rubricasSubscription = this.rubricas()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((rubricas) => {
          if (
            !this.objectHandling.areObjectsEqual(
              rubricas,
              this.previousRubricas
            )
          ) {
            this.previousRubricas = rubricas;
          }

          this.viewportRubricas = rubricas;
          rubricas.forEach((rubrica) =>
            this.rubricaDetails.set(rubrica.name, rubrica)
          );
          this.shouldEmitRubricasForm = false;

          rubricas.forEach((rubrica) => {
            if (!this.rubricasForm.contains(rubrica.name)) {
              this.rubricasForm.addControl(
                rubrica.name,
                this.formBuilder.control(this.autoSelectNewRubricas, {
                  nonNullable: true,
                })
              );
            }
          });
          Object.keys(this.rubricasForm.controls).forEach((key) => {
            if (
              !rubricas.find((rubrica) => rubrica.name === key) &&
              !this.rubricasForm.controls[key].value
            ) {
              this.rubricasForm.removeControl(key, { emitEvent: false });
            }
          });
          this.refreshDisplayedRubricas();

          this.shouldEmitRubricasForm = true;
          this.rubricasFormEvent.emit(this.rubricasForm.getRawValue());
        });
    }

    if (changes['periods']) {
      if (this.periodsSubscription) {
        this.periodsSubscription.unsubscribe();
      }

      this.periodsSubscription = this.periods()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((periods) => {
          this.viewportPeriods = periods;
          periods.forEach((period) =>
            this.periodDetails.set(period.name, period)
          );
          this.refreshDisplayedPeriods();
        });
    }
  }

  ngOnInit(): void {
    this.rubricasForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.shouldEmitRubricasForm) {
          this.autoSelectNewRubricas = false;
          this.removeHiddenUnselectedRubricas();
          this.refreshDisplayedRubricas();
          this.rubricasFormEvent.emit(this.rubricasForm.getRawValue());
        }
      });

    this.periodControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((period) => {
        this.refreshDisplayedPeriods();
        this.periodFilterEvent.emit(
          period === ALL_PERIOD_VALUE ? null : period
        );
      });

    this.hourForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.emitHourFilter();
      });
  }

  cleanForm(sectionName: string) {
    switch (sectionName) {
      case 'address':
        this.dataForm.controls.street.setValue('');
        this.dataForm.controls.city.setValue('');
        break;
      case 'date':
        this.applyDateRange();
        break;
      default:
    }
  }

  onSubmit() {
    const formValues = this.dataForm.getRawValue();
    this.submitEvent.emit({
      beforeDate: this.dateService.formatYYYYMMDD(formValues.beforeDate),
      afterDate: this.dateService.formatYYYYMMDD(formValues.afterDate),
      street: formValues.street ?? '',
      city: formValues.city ?? '',
      state: formValues.state ?? '',
    });
  }

  onAddressEnter(event: Event): void {
    event.preventDefault();

    if (this.dataForm.valid) {
      this.onSubmit();
    }
  }

  rubricaIcon(rubrica: string): string {
    return this.markersService.markerChooser(rubrica);
  }

  openVisibleCharts(): void {
    this.visibleChartsEvent.emit();
  }

  selectAllRubricas(): void {
    this.autoSelectNewRubricas = true;
    this.setAllRubricasSelected(true);
  }

  unselectAllRubricas(): void {
    this.autoSelectNewRubricas = false;
    this.setAllRubricasSelected(false);
  }

  hasRubricas(): boolean {
    return Object.keys(this.rubricasForm.controls).length > 0;
  }

  private setAllRubricasSelected(selected: boolean): void {
    Object.values(this.rubricasForm.controls).forEach((control) => {
      control.setValue(selected, { emitEvent: false });
    });
    this.removeHiddenUnselectedRubricas();
    this.refreshDisplayedRubricas();
    this.rubricasFormEvent.emit(this.rubricasForm.getRawValue());
  }

  private removeHiddenUnselectedRubricas(): void {
    const viewportNames = new Set(
      this.viewportRubricas.map((rubrica) => rubrica.name)
    );

    Object.entries(this.rubricasForm.controls).forEach(([name, control]) => {
      if (!viewportNames.has(name) && !control.value) {
        this.rubricasForm.removeControl(name, { emitEvent: false });
      }
    });
  }

  private refreshDisplayedRubricas(): void {
    const viewportNames = new Set(
      this.viewportRubricas.map((rubrica) => rubrica.name)
    );
    const selectedOutsideViewport = Object.entries(
      this.rubricasForm.getRawValue()
    )
      .filter(([name, selected]) => selected && !viewportNames.has(name))
      .map(([name]) => this.rubricaDetails.get(name))
      .filter((rubrica): rubrica is CategoryInfo => Boolean(rubrica))
      .map((rubrica) => ({ ...rubrica, count: 0 }));

    this.displayedRubricas.set([
      ...this.viewportRubricas,
      ...selectedOutsideViewport,
    ]);
  }

  private refreshDisplayedPeriods(): void {
    const selectedPeriod = this.periodControl.value;
    const selectedOutsideViewport =
      selectedPeriod !== ALL_PERIOD_VALUE &&
      !this.viewportPeriods.some((period) => period.name === selectedPeriod)
        ? this.periodDetails.get(selectedPeriod)
        : undefined;

    this.displayedPeriods.set([
      ...this.viewportPeriods,
      ...(selectedOutsideViewport
        ? [{ ...selectedOutsideViewport, count: 0 }]
        : []),
    ]);
  }

  private emitHourFilter(): void {
    if (!this.hourForm.valid) {
      return;
    }

    const formValue = this.hourForm.getRawValue();
    const startHour = this.getHour(formValue.startTime);
    const endHour = this.getHour(formValue.endTime);

    if (startHour === null || endHour === null) {
      return;
    }

    this.hourFilterEvent.emit({
      enabled: formValue.enabled,
      startHour,
      endHour,
    });
  }

  private applyDateRange(): void {
    const earliest = this.dateService.parseDateOnly(this.dateRange()?.earliest);
    const latest = this.dateService.parseDateOnly(this.dateRange()?.latest);
    const defaultAfterDate = this.dateService.defaultAfterDate(
      this.dateRange()
    );

    this.minDate = earliest;
    this.maxDate = latest;

    this.dataForm.patchValue({
      afterDate: defaultAfterDate,
      beforeDate: latest,
    });
  }

  private createTime(hour: number): Date {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    return date;
  }

  private getHour(value: TimeControlValue): number | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getHours();
    }

    if (typeof value === 'string') {
      const match = value.match(/^([01]?\d|2[0-3]):00$/);
      return match ? Number(match[1]) : null;
    }

    return null;
  }

  private hourOnlyTimeValidator(control: {
    value: TimeControlValue;
  }): { hourOnly: true } | null {
    const value = control.value;

    if (!value) {
      return { hourOnly: true };
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getMinutes() === 0 &&
        value.getSeconds() === 0 &&
        value.getMilliseconds() === 0
        ? null
        : { hourOnly: true };
    }

    if (typeof value === 'string') {
      return /^([01]?\d|2[0-3]):00$/.test(value) ? null : { hourOnly: true };
    }

    return { hourOnly: true };
  }
}
