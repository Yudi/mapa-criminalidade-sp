import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { ProgressBarService } from './progressbar.service';

export const progressBarInterceptor: HttpInterceptorFn = (request, next) => {
  const progressBarService = inject(ProgressBarService);
  const isBackendRequest =
    request.url.startsWith(environment.apiUrl) || request.url.startsWith('/api');

  if (!isBackendRequest) {
    return next(request);
  }

  progressBarService.requestStarted();

  return next(request).pipe(
    finalize(() => {
      progressBarService.requestFinished();
    })
  );
};
