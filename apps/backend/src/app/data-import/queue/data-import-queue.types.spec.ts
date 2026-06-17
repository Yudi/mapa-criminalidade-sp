import {
  dataImportJobDataSchema,
  dataImportJobNameSchema,
  dataImportScheduleDefinitionsSchema,
} from './data-import-queue.types';

describe('data import queue schemas', () => {
  it('accepts valid manual import job payloads', () => {
    expect(
      dataImportJobDataSchema.parse({
        requestedAt: '2026-06-11T00:00:00.000Z',
        requestedBy: 'manual',
        reason: 'manual category import',
        categoryName: 'Dados Criminais',
      })
    ).toEqual({
      requestedAt: '2026-06-11T00:00:00.000Z',
      requestedBy: 'manual',
      reason: 'manual category import',
      categoryName: 'Dados Criminais',
    });
  });

  it('rejects unsupported queue job names', () => {
    expect(() => dataImportJobNameSchema.parse('delete-everything')).toThrow();
  });

  it('rejects empty schedule lists', () => {
    expect(() => dataImportScheduleDefinitionsSchema.parse([])).toThrow();
  });
});

