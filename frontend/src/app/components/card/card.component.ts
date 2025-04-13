import {
  AfterViewInit,
  Component,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnInit,
  output,
  Output,
  signal,
  SimpleChanges,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import {
  MatDatepickerIntl,
  MatDatepickerModule,
} from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import DataFormValues from '../../shared/dataForm.interface';
import { HttpClient } from '@angular/common/http';
import {
  distinct,
  filter,
  map,
  Observable,
  Subscription,
  take,
  tap,
} from 'rxjs';
import { AsyncPipe, JsonPipe } from '@angular/common';
import { BoletimOcorrencia } from '../../shared/schema.interface';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ObjectHandlingService } from '../../shared/object-handling.service';
import { QueriesService } from '../../shared/queries.service';
import { DateService } from '../../shared/date.service';

@Component({
  selector: 'app-card',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatCheckboxModule,
    ReactiveFormsModule,
    FormsModule,
    MatInputModule,
    MatListModule,
    MatButtonToggleModule,
    AsyncPipe,
  ],
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
})
export class CardComponent implements OnChanges, OnInit {
  @Input({ required: true }) rubricas!: Observable<
    { name: string; count: number }[]
  >;

  submitEvent = output<DataFormValues>();
  rubricasFormEvent = output<{
    [key: string]: boolean;
  }>();

  private objectHandling = inject(ObjectHandlingService);
  private queriesService = inject(QueriesService);
  private dateService = inject(DateService);

  private formBuilder = inject(FormBuilder);
  addressDirty = false;
  dataForm = new FormGroup(
    {
      beforeDate: new FormControl(''),
      afterDate: new FormControl(''),
      radius: new FormControl(2000, Validators.required),
      street: new FormControl(''),
      city: new FormControl('', Validators.required),

      state: new FormControl(
        { value: 'São Paulo', disabled: true },
        Validators.required,
      ),
    },
    {
      validators: this.dateService.beforeAfterFormValidator(
        'beforeDate',
        'afterDate',
      ),
    },
  );

  shouldEmitRubricasForm = true;

  rubricasForm = this.formBuilder.group({});
  private rubricasSubscription: Subscription | null = null;
  private previousRubricas: { name: string; count: number }[] | null = null;

  public minDate: string | null = null;
  public maxDate: string | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['rubricas'] && this.rubricas) {
      // Unsubscribe from the previous subscription if it exists
      if (this.rubricasSubscription) {
        this.rubricasSubscription.unsubscribe();
      }
      this.rubricasSubscription = this.rubricas.subscribe((rubricas) => {
        // Check if the new rubricas array is different from the previous one
        if (
          !this.objectHandling.areObjectsEqual(rubricas, this.previousRubricas)
        ) {
          this.previousRubricas = rubricas; // Update the previous rubricas to the new one
        }

        this.shouldEmitRubricasForm = false;

        rubricas.forEach((rubrica) => {
          if (!this.rubricasForm.contains(rubrica.name)) {
            this.rubricasForm.addControl(
              rubrica.name,
              this.formBuilder.control(false),
            );
          }
        });

        // If there are formcontrols that are not in the rubricas array, remove them
        Object.keys(this.rubricasForm.controls).forEach((key) => {
          if (!rubricas.find((rubrica) => rubrica.name === key)) {
            this.rubricasForm.removeControl(key);
          }
        });

        this.shouldEmitRubricasForm = true;
      });
    }
  }

  ngOnInit(): void {
    this.rubricasForm.valueChanges.subscribe(() => {
      if (this.shouldEmitRubricasForm) {
        this.rubricasFormEvent.emit(this.rubricasForm.getRawValue());
      }
    });

    this.queriesService
      .getLastDate()
      .pipe(
        take(1),
        tap((response) => {
          if (response) {
            this.dataForm.controls.beforeDate.setValue(response);

            const date = new Date(response);
            date.setMonth(date.getMonth() - 3);
            const formattedDate = date.toISOString().split('T')[0];
            this.dataForm.controls.afterDate.setValue(formattedDate);

            this.maxDate = response;
          }
        }),
      )
      .subscribe();

    this.queriesService
      .getFirstDate()
      .pipe(
        take(1),
        tap((response) => {
          if (response) {
            this.minDate = response;
          }
        }),
      )
      .subscribe();
  }

  cleanForm(sectionName: string) {
    switch (sectionName) {
      case 'address':
        this.dataForm.controls.street.setValue('');
        this.dataForm.controls.city.setValue('');
        break;
      case 'date':
        this.dataForm.controls.beforeDate.setValue('');
        this.dataForm.controls.afterDate.setValue('');
        break;
      default:
    }
  }

  onSubmit() {
    const formValues = this.dataForm.getRawValue() as DataFormValues;
    this.submitEvent.emit(formValues);
  }
}
