import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TimeoutError } from 'rxjs';

export const REQUEST_TIMEOUT_MESSAGE =
  'A consulta demorou mais que o esperado e não pôde ser concluída. Tente reduzir o período ou os filtros e faça uma nova busca.';

export class RequestTimeoutError extends Error {
  constructor() {
    super(REQUEST_TIMEOUT_MESSAGE);
    this.name = 'RequestTimeoutError';
  }
}

export function isRequestTimeoutError(error: unknown): boolean {
  return (
    error instanceof RequestTimeoutError ||
    error instanceof TimeoutError ||
    (error instanceof HttpErrorResponse &&
      (error.status === 408 || error.status === 504))
  );
}

@Injectable({
  providedIn: 'root',
})
export class RequestTimeoutService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private notificationOpen = false;

  notify(): void {
    if (!this.isBrowser || this.notificationOpen) {
      return;
    }

    this.notificationOpen = true;
    this.snackBar
      .open(REQUEST_TIMEOUT_MESSAGE, 'Fechar', {
        duration: 12_000,
        politeness: 'assertive',
      })
      .afterDismissed()
      .subscribe(() => {
        this.notificationOpen = false;
      });
  }
}
