import {
  AfterViewInit,
  Component,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnInit,
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
import { distinct, filter, map, Observable, Subscription, take } from 'rxjs';
import { AsyncPipe, JsonPipe } from '@angular/common';
import { BoletimOcorrencia } from '../../shared/schema.interface';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ObjectHandlingService } from '../../shared/object-handling.service';

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
  @Input({ required: true }) response!: Observable<BoletimOcorrencia[] | null>;
  @Input({ required: true }) rubricas!: Observable<
    { name: string; count: number }[]
  >;
  @Output('submitEvent') submitEvent = new EventEmitter<DataFormValues>();
  @Output('rubricasFormEvent') rubricasFormEvent = new EventEmitter<{
    [key: string]: boolean;
  }>();

  private formBuilder = inject(FormBuilder);
  addressDirty = false;
  dataForm = new FormGroup({
    beforeDate: new FormControl(''),
    afterDate: new FormControl(''),
    radius: new FormControl(2000, Validators.required),
    street: new FormControl(''),
    city: new FormControl('', Validators.required),

    state: new FormControl(
      { value: 'São Paulo', disabled: true },
      Validators.required,
    ),
  });

  shouldEmitRubricasForm = true;

  rubricasForm = this.formBuilder.group({});
  private rubricasSubscription: Subscription | null = null;
  private previousRubricas: { name: string; count: number }[] | null = null;
  private objectHandling = inject(ObjectHandlingService);

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
