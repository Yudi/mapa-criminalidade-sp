import { Injectable, WritableSignal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ProgressBarService {
  addToProgressBar(
    value: number,
    currentProgress: WritableSignal<number>,
  ): void {
    currentProgress.update((currentValue) => currentValue + value);
  }
}
