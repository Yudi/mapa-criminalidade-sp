import { computed, Injectable, signal, WritableSignal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ProgressBarService {
  private readonly activeRequests = signal(0);
  readonly isLoading = computed(() => this.activeRequests() > 0);

  requestStarted(): void {
    this.activeRequests.update((currentValue) => currentValue + 1);
  }

  requestFinished(): void {
    this.activeRequests.update((currentValue) =>
      Math.max(currentValue - 1, 0)
    );
  }

  addToProgressBar(
    value: number,
    currentProgress: WritableSignal<number>,
  ): void {
    currentProgress.update((currentValue) => currentValue + value);
  }
}
