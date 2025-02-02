import {
  Component,
  EventEmitter,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { CardComponent } from './components/card/card.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { MapComponent } from './components/map/map.component';

import { isPlatformBrowser } from '@angular/common';
import { FormGroup } from '@angular/forms';
import DataFormValues from './shared/dataForm.interface';
import { QueriesService } from './shared/queries.service';
import {
  distinct,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs';
import { BoletimOcorrencia } from './shared/schema.interface';

@Component({
  selector: 'app-root',
  imports: [CardComponent, ToolbarComponent, MapComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'frontend';
  private platformId = inject(PLATFORM_ID);
  private queriesService = inject(QueriesService);

  response: Observable<BoletimOcorrencia[] | null> = new Observable();
  rubricas: Observable<{ name: string; count: number }[]> = new Observable();
  rubricasFormValues: { [key: string]: boolean } | undefined;

  showIndeterminateProgressBar = signal(false);
  progressBarPercentage = signal(-1);

  addressCenter: {
    lon: number | null;
    lat: number | null;
    radius: number | null;
    before: string | null;
    after: string | null;
  } = {
    lon: null,
    lat: null,
    radius: null,
    before: null,
    after: null,
  };

  get isBrowserOnly(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  onRubricasFormChange(rubricasFormValues: { [key: string]: boolean }) {
    this.rubricasFormValues = rubricasFormValues;
  }

  onSubmitEvent(dataForm: DataFormValues) {
    this.showIndeterminateProgressBar.set(true);

    // Define the observable for querying the address
    const addressQuery$ = this.queriesService
      .queryAddress(dataForm.street, dataForm.city, dataForm.state)
      .pipe(
        shareReplay(1), // Share the result for reuse without re-triggering the request
        distinctUntilChanged(), // Only emit if the address changes
      );

    // Define the response observable that makes the database query after address resolution
    this.response = addressQuery$.pipe(
      distinctUntilChanged(), // Only emit if the address changes
      tap((addressResult) => {
        this.addressCenter = {
          lon: addressResult[0].lon,
          lat: addressResult[0].lat,
          radius: dataForm.radius,
          before: dataForm.beforeDate,
          after: dataForm.afterDate,
        };
      }),
      switchMap((addressResult) => {
        // After updating state with address, make the database query
        return this.queriesService.queryDatabase(
          addressResult[0].lat,
          addressResult[0].lon,
          dataForm.radius,
          dataForm.beforeDate,
          dataForm.afterDate,
        );
      }),
    );

    this.rubricas = this.response.pipe(
      take(1), // Only take the first value from the response
      map((response) => response?.map((bo) => bo.rubrica)), // Extract rubrica from each item
      filter((rubricas) => rubricas != null), // Filter out any null or undefined rubricas
      map((rubricas) => {
        // Count occurrences first
        const rubricaCountMap = rubricas.reduce(
          (acc, name) => {
            if (name != null) {
              acc[name] = (acc[name] || 0) + 1; // Increment count for each rubrica
            }
            return acc;
          },
          {} as Record<string, number>,
        );

        // Convert map to an array of objects in the desired format and sort by count
        return Object.entries(rubricaCountMap)
          .map(([name, count]) => ({
            name,
            count,
          }))
          .sort((a, b) => b.count - a.count); // Sort by count in descending order
      }),
      shareReplay(1),
    );
  }
}
