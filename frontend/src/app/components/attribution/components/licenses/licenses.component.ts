import { AsyncPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal, WritableSignal } from '@angular/core';
import { catchError, Observable, retry, shareReplay, throwError } from 'rxjs';
import { AgplComponent } from '../agpl/agpl.component';
import { SvgAttributionComponent } from '../svg/svg-attribution.component';

@Component({
  selector: 'app-licenses',
  imports: [AsyncPipe, AgplComponent, SvgAttributionComponent],
  templateUrl: './licenses.component.html',
  styleUrl: './licenses.component.scss',
})
export class LicensesComponent {
  licenses: Observable<string>;
  error: WritableSignal<boolean> = signal(false);
  readonly http = inject(HttpClient);

  constructor() {
    this.licenses = this.http
      .get('/3rdpartylicenses.txt', { responseType: 'text' })
      .pipe(
        retry(3),
        shareReplay(1),
        catchError((err) => {
          this.error.set(true);
          return this.handleError(err);
        }),
      );
  }

  handleError(error: HttpErrorResponse): Observable<never> {
    if (error.status === 0) {
      // A client-side or network error occurred.
      return throwError(() => new Error(`An error occurred: ${error.error}`));
    } else {
      // The backend returned an unsuccessful response code.
      return throwError(
        () =>
          new Error(
            `Server returned code ${error.status} for 3rdpartylicenses.txt request`,
          ),
      );
    }
  }
}
