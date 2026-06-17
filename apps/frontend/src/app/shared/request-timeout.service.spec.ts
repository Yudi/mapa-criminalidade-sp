import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import {
  REQUEST_TIMEOUT_MESSAGE,
  RequestTimeoutService,
} from './request-timeout.service';

describe('RequestTimeoutService', () => {
  it('deduplicates timeout notifications until the snackbar closes', () => {
    const afterDismissed = new Subject<void>();
    const snackBar = {
      open: vi.fn(() => ({
        afterDismissed: () => afterDismissed,
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        RequestTimeoutService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });

    const service = TestBed.inject(RequestTimeoutService);
    service.notify();
    service.notify();

    expect(snackBar.open).toHaveBeenCalledTimes(1);
    expect(snackBar.open).toHaveBeenCalledWith(
      REQUEST_TIMEOUT_MESSAGE,
      'Fechar',
      expect.objectContaining({ politeness: 'assertive' })
    );

    afterDismissed.next();
    service.notify();

    expect(snackBar.open).toHaveBeenCalledTimes(2);
  });
});
