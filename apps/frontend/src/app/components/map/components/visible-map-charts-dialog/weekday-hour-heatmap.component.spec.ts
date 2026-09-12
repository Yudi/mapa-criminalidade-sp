import { TestBed } from '@angular/core/testing';
import {
  buildWeekdayHourMatrix,
  WeekdayHourHeatmapComponent,
} from './weekday-hour-heatmap.component';

describe('weekday × hour heatmap', () => {
  it('keeps midnight, Sunday night, unknown hours and missing dates distinct', () => {
    const matrix = buildWeekdayHourMatrix([
      { weekday: 1, hour: 0, count: 2 },
      { weekday: 7, hour: 23, count: 3 },
      { weekday: 1, hour: null, count: 100 },
      { weekday: null, hour: 12, count: 4 },
      { weekday: null, hour: null, count: 5 },
    ]);
    expect(matrix.rows).toHaveLength(7);
    expect(matrix.rows.every((row) => row.cells.length === 24)).toBe(true);
    expect(matrix.rows[0].label).toBe('Domingo');
    expect(matrix.rows[0].cells[23].count).toBe(3);
    expect(matrix.rows[1].label).toBe('Segunda');
    expect(matrix.rows[1].cells[0].count).toBe(2);
    expect(matrix.rows[1].unknown).toBe(100);
    expect(matrix.maximum).toBe(3);
    expect(matrix.known).toBe(5);
    expect(matrix.unknownHour).toBe(105);
    expect(matrix.unknownDate).toBe(9);
    expect(matrix.unknownBoth).toBe(5);
    expect(
      matrix.known +
        matrix.unknownHour +
        matrix.unknownDate -
        matrix.unknownBoth
    ).toBe(114);
  });

  it('renders a complete accessible table and updates an empty result when filters change', () => {
    const fixture = TestBed.createComponent(WeekdayHourHeatmapComponent);
    fixture.componentRef.setInput('buckets', []);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('tbody td.heat')).toHaveLength(168);
    expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(7);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'Não há ocorrências'
    );
    fixture.componentRef.setInput('buckets', [
      { weekday: 2, hour: 9, count: 12 },
    ]);
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(
      host.querySelector('td[title="Terça, 09h: 12 ocorrências"]')?.textContent
    ).toMatch(/^\s*12\s*$/);
    expect(host.querySelectorAll('.heat--5')).toHaveLength(2); // One cell and the legend.
  });
});
