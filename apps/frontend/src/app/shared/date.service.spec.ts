import { FormControl, FormGroup } from '@angular/forms';
import { DateService } from './date.service';

describe('DateService', () => {
  const service = new DateService();

  it('rejects impossible date-only values instead of allowing Date rollover', () => {
    expect(service.parseDateOnly('2024-02-29')).toEqual(new Date(2024, 1, 29));
    expect(service.parseDateOnly('2023-02-29')).toBeNull();
    expect(service.parseDateOnly('2024-02-31')).toBeNull();
    expect(service.formatYYYYMMDD('2024-02-31')).toBe('');
  });

  it('rejects an invalid or reversed date range in reactive forms', () => {
    const group = new FormGroup({
      before: new FormControl('2024-02-31'),
      after: new FormControl('2024-01-01'),
    });
    const validator = service.beforeAfterFormValidator('before', 'after');

    expect(validator(group)).toEqual({ beforeAfter: true });

    group.controls.before.setValue('2024-12-31');
    group.controls.after.setValue('2025-01-01');
    expect(validator(group)).toEqual({ beforeAfter: true });
  });
});
