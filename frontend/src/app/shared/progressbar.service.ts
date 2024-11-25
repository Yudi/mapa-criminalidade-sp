import { Injectable, WritableSignal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ProgressBarService {
  addToProgressBar(
    value: number,
    currentProgress: WritableSignal<number>,
  ): void {
    if (value + currentProgress() > 90) {
      currentProgress.set(90);
    } else {
      currentProgress.update((currentValue) => currentValue + value);
    }
  }
}
