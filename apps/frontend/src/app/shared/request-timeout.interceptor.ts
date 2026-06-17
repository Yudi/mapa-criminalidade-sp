import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  isRequestTimeoutError,
  RequestTimeoutError,
  RequestTimeoutService,
} from './request-timeout.service';

export const BACKEND_REQUEST_TIMEOUT_MS = 45_000;

export const requestTimeoutInterceptor: HttpInterceptorFn = (request, next) => {
  const tileUrlPrefix = environment.tileUrlTemplate.split('{z}')[0];
  const isBackendRequest =
    request.url.startsWith(environment.apiUrl) ||
    request.url.startsWith('/api') ||
    request.url.startsWith(tileUrlPrefix);

  if (!isBackendRequest) {
    return next(request);
  }

  const requestTimeoutService = inject(RequestTimeoutService);

  return next(request).pipe(
    timeout(BACKEND_REQUEST_TIMEOUT_MS),
    catchError((error: unknown) => {
      if (!isRequestTimeoutError(error)) {
        return throwError(() => error);
      }

      requestTimeoutService.notify();
      return throwError(() => new RequestTimeoutError());
    })
  );
};
