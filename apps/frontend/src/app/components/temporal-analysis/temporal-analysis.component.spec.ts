import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { MapFeatureTemporalStats } from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../shared/occurrences.service';
import { TemporalAnalysisComponent } from './temporal-analysis.component';

const stats: MapFeatureTemporalStats = {
  datasetRevision: 'fixture',
  total: 4,
  monthly: [{ label: '2024-01', count: 4 }],
  categories: [{ label: 'Furto', count: 4 }],
};
const coverage = {
  earliest: '2020-01-01',
  latest: '2024-03-31',
  defaultAfter: '2024-01-01',
};
const filter = {
  afterDate: '2024-01-01',
  beforeDate: '2024-03-31',
  categories: ['Furto'],
  area: { longitude: -46.6, latitude: -23.5, radius: 500 },
  startHour: 22,
  endHour: 4,
};

describe('TemporalAnalysisComponent', () => {
  let getTemporalStats: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    getTemporalStats = vi.fn(() => of(stats));
    await TestBed.configureTestingModule({
      imports: [TemporalAnalysisComponent],
      providers: [
        { provide: OccurrencesService, useValue: { getTemporalStats } },
      ],
    })
      .overrideComponent(TemporalAnalysisComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const fixture = TestBed.createComponent(TemporalAnalysisComponent);
    fixture.componentRef.setInput('filter', filter);
    fixture.componentRef.setInput('coverage', coverage);
    fixture.detectChanges();
    return fixture;
  }

  it('waits for the matching rendered month and ignores stale readiness', () => {
    const fixture = setup();
    const panel = fixture.componentInstance;
    panel.play();
    expect(panel.active()?.month).toBe('2024-01');
    vi.advanceTimersByTime(4000);
    expect(panel.active()?.month).toBe('2024-01');
    fixture.componentRef.setInput('mapState', {
      after: '2023-01-01',
      before: '2023-01-31',
      status: 'ready',
    });
    fixture.detectChanges();
    vi.advanceTimersByTime(2000);
    expect(panel.active()?.month).toBe('2024-01');
    fixture.componentRef.setInput('mapState', {
      after: '2024-01-01',
      before: '2024-01-31',
      status: 'ready',
    });
    fixture.detectChanges();
    vi.advanceTimersByTime(1500);
    expect(panel.active()?.month).toBe('2024-02');
    fixture.destroy();
  });

  it('pauses on failures and clears timers on restore and destruction', () => {
    const fixture = setup();
    const panel = fixture.componentInstance;
    const changed = vi.fn();
    panel.frameChange.subscribe(changed);
    panel.play();
    fixture.componentRef.setInput('mapState', {
      after: '2024-01-01',
      before: '2024-01-31',
      status: 'error',
    });
    fixture.detectChanges();
    expect(panel.playing()).toBe(false);
    expect(panel.playbackError()).toContain('Falha ao carregar');
    panel.restore();
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(panel.active()).toBeNull();
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses identical geographic and non-date filters for both periods', () => {
    const fixture = setup();
    const panel = fixture.componentInstance;
    getTemporalStats.mockClear();
    panel.comparisonForm.setValue({ first: '2024-01', second: '2024-02' });
    panel.loadComparison();
    expect(getTemporalStats.mock.calls.map(([value]) => value)).toEqual([
      { ...filter, afterDate: '2024-01-01', beforeDate: '2024-01-29' },
      { ...filter, afterDate: '2024-02-01', beforeDate: '2024-02-29' },
    ]);
    expect(panel.results()?.first.total).toBe(4);
    panel.comparisonForm.controls.first.setValue('2024-03');
    expect(panel.results()).toBeNull();
    fixture.destroy();
  });

  it('rejects comparisons across dataset revisions', () => {
    const fixture = setup();
    const panel = fixture.componentInstance;
    getTemporalStats
      .mockReturnValueOnce(of(stats))
      .mockReturnValueOnce(of({ ...stats, datasetRevision: 'changed' }));
    panel.loadComparison();
    expect(panel.results()).toBeNull();
    expect(panel.comparisonError()).toContain('atualizados');
    fixture.destroy();
  });

  it('cancels old comparisons when inputs change', () => {
    const fixture = setup();
    const panel = fixture.componentInstance;
    const pending = new Subject<MapFeatureTemporalStats>();
    getTemporalStats.mockReturnValue(pending);
    panel.loadComparison();
    panel.comparisonForm.controls.first.setValue('2023-01');
    pending.next(stats);
    expect(panel.results()).toBeNull();
    expect(panel.comparing()).toBe(false);
    fixture.destroy();
  });
});
