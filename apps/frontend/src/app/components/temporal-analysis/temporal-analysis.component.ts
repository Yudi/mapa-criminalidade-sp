import {
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  DOCUMENT,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { Subscription, switchMap, map } from 'rxjs';
import {
  DateRange,
  MapFeatureFilterInput,
  MapFeatureTemporalStats,
} from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../shared/occurrences.service';
import {
  ChartCardComponent,
  VisibleMapChartConfig,
} from '../map/components/visible-map-charts-dialog/chart-card.component';
import {
  ComparisonUnit,
  MonthlyFrame,
  TemporalRange,
  TemporalMapState,
  brazilToday,
  categoryChanges,
  compareRanges,
  displayDate,
  monthlyFrames,
  previousDay,
} from './temporal-analysis.utils';

@Component({
  selector: 'app-temporal-analysis',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    MatIconModule,
    ChartCardComponent,
  ],
  templateUrl: './temporal-analysis.component.html',
  styleUrl: './temporal-analysis.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemporalAnalysisComponent implements OnChanges, OnDestroy {
  readonly filter = input.required<MapFeatureFilterInput>();
  readonly coverage = input.required<DateRange>();
  readonly mapState = input<TemporalMapState | null>(null);
  readonly playbackEnabled = input(true);
  readonly frameChange = output<TemporalRange | null>();
  readonly closed = output<void>();
  readonly focusMap = output<void>();
  private readonly occurrences = inject(OccurrencesService);
  private readonly document = inject(DOCUMENT);
  private readonly visibilityChange = () => {
    if (this.document.hidden) this.pause();
  };
  constructor() {
    this.document.addEventListener('visibilitychange', this.visibilityChange);
  }
  readonly mode = signal<ComparisonUnit>('month');
  readonly comparisonForm = new FormGroup({
    first: new FormControl('', { nonNullable: true }),
    second: new FormControl('', { nonNullable: true }),
  });
  readonly trendForm = new FormGroup({
    afterDate: new FormControl('', { nonNullable: true }),
    beforeDate: new FormControl('', { nonNullable: true }),
  });
  readonly loading = signal(false);
  readonly comparing = signal(false);
  readonly error = signal<string | null>(null);
  readonly comparisonError = signal<string | null>(null);
  readonly playbackError = signal<string | null>(null);
  readonly frames = signal<MonthlyFrame[]>([]);
  readonly activeIndex = signal<number | null>(null);
  readonly playing = signal(false);
  readonly active = computed(
    () => this.frames()[this.activeIndex() ?? -1] ?? null
  );
  readonly comparable = signal<ReturnType<typeof compareRanges>>(null);
  readonly results = signal<{
    first: MapFeatureTemporalStats;
    second: MapFeatureTemporalStats;
  } | null>(null);
  readonly changes = computed(() => {
    const results = this.results();
    return results
      ? categoryChanges(results.first.categories, results.second.categories)
      : [];
  });
  readonly chart = computed<VisibleMapChartConfig>(() => ({
    title: 'Ocorrências por mês',
    subtitle: this.frames().some(
      (frame) => frame.partial && frame.count !== null
    )
      ? '* mês parcial'
      : '',
    compact: true,
    icon: 'show_chart',
    displayType: 'line',
    missingLabels: this.frames()
      .filter((frame) => frame.count === null)
      .map((frame) => this.chartMonth(frame)),
    buckets: this.frames().map((frame) => ({
      label: this.chartMonth(frame),
      count: frame.count ?? 0,
    })),
  }));
  private chartMonth(frame: MonthlyFrame): string {
    return `${frame.month.slice(5)}/${frame.month.slice(2, 4)}${
      frame.partial ? '*' : ''
    }`;
  }

  readonly hasPlayableFrames = computed(() =>
    this.frames().some((frame) => frame.count !== null)
  );
  readonly displayDate = displayDate;
  private trendRequest?: Subscription;
  private compareRequest?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private readonly formChanges = this.comparisonForm.valueChanges.subscribe(
    () => this.clearComparison()
  );
  private readonly trendChanges = this.trendForm.valueChanges.subscribe(() => {
    this.trendRequest?.unsubscribe();
    this.restore();
    this.frames.set([]);
    this.loading.set(false);
    this.error.set(null);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filter'] || changes['coverage']) {
      const filter = this.filter();
      this.trendForm.setValue({
        afterDate: filter.afterDate ?? this.coverage().defaultAfter ?? '',
        beforeDate: filter.beforeDate ?? this.coverage().latest ?? '',
      });
      this.setMode(this.mode());
      this.loadTrends();
    }
    if (changes['playbackEnabled'] && !this.playbackEnabled()) this.restore();
    if (changes['mapState']) {
      const state = this.mapState();
      const frame = this.active();
      if (
        frame &&
        state?.after === frame.afterDate &&
        state.before === frame.beforeDate
      ) {
        if (state.status === 'error') {
          this.pause();
          this.playbackError.set(
            'Falha ao carregar o mapa. Selecione o mês para tentar novamente.'
          );
        } else if (state.status === 'ready') {
          clearTimeout(this.watchdog);
          this.scheduleNext();
        }
      }
    }
  }

  setMode(unit: ComparisonUnit): void {
    this.mode.set(unit);
    const latest = (
      this.filter().beforeDate ??
      this.coverage().latest ??
      brazilToday()
    ).slice(0, 7);
    const reference = new Date(`${latest}-01T00:00:00Z`);
    if (unit === 'month') reference.setUTCMonth(reference.getUTCMonth() - 1);
    else reference.setUTCFullYear(reference.getUTCFullYear() - 1);
    this.comparisonForm.setValue({
      first: reference.toISOString().slice(0, unit === 'month' ? 7 : 4),
      second: latest.slice(0, unit === 'month' ? 7 : 4),
    });
  }

  loadComparison(): void {
    this.clearComparison();
    const { first, second } = this.comparisonForm.getRawValue();
    const ranges = compareRanges(first, second, this.mode(), this.coverage());
    if (!ranges) {
      this.comparisonError.set(
        'Sem datas equivalentes. Escolha outros períodos.'
      );
      return;
    }
    this.comparable.set(ranges);
    this.comparing.set(true);
    // Sequential scans respect the small production statistics pool.
    this.compareRequest = this.occurrences
      .getTemporalStats({ ...this.filter(), ...ranges.first })
      .pipe(
        switchMap((first) =>
          this.occurrences
            .getTemporalStats({ ...this.filter(), ...ranges.second })
            .pipe(map((second) => ({ first, second })))
        )
      )
      .subscribe({
        next: (results) => {
          this.comparing.set(false);
          if (
            !results.first.datasetRevision ||
            results.first.datasetRevision !== results.second.datasetRevision
          ) {
            this.comparisonError.set('Dados atualizados. Compare novamente.');
            return;
          }
          this.results.set(results);
        },
        error: () => {
          this.comparing.set(false);
          this.comparisonError.set('Falha na comparação. Tente novamente.');
        },
      });
  }

  loadTrends(): void {
    this.trendRequest?.unsubscribe();
    this.restore();
    this.frames.set([]);
    this.error.set(null);
    const range = this.trendForm.getRawValue();
    const frames = monthlyFrames(range, this.coverage(), []);
    if (!frames.length) {
      this.error.set('Informe um intervalo válido de até 120 meses.');
      return;
    }
    const covered = frames.filter((frame) => frame.count !== null);
    if (!covered.length) {
      this.frames.set(frames);
      return;
    }
    this.loading.set(true);
    // The query and the displayed partial-month labels use exactly the same cutoff.
    this.trendRequest = this.occurrences
      .getTemporalStats({
        ...this.filter(),
        afterDate: covered[0].afterDate,
        beforeDate: covered[covered.length - 1].beforeDate,
      })
      .subscribe({
        next: (stats) => {
          this.frames.set(monthlyFrames(range, this.coverage(), stats.monthly));
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set(
            'Falha ao carregar. Reduza o intervalo ou tente novamente.'
          );
        },
      });
  }

  selectFrame(index: number): void {
    this.pause();
    this.showFrame(index);
    if (this.active()) this.focusMap.emit();
  }

  play(): void {
    if (!this.playbackEnabled()) return;
    if (this.playing()) {
      this.pause();
      return;
    }
    this.playbackError.set(null);
    this.playing.set(true);
    const current = this.activeIndex();
    const next = this.frames().findIndex(
      (frame, index) => frame.count !== null && index > (current ?? -1)
    );
    this.showFrame(
      next === -1
        ? this.frames().findIndex((frame) => frame.count !== null)
        : next
    );
    if (this.active()) this.focusMap.emit();
  }

  pause(): void {
    this.playing.set(false);
    clearTimeout(this.timer);
    clearTimeout(this.watchdog);
  }

  restore(): void {
    this.pause();
    this.activeIndex.set(null);
    this.playbackError.set(null);
    this.frameChange.emit(null);
  }

  ngOnDestroy(): void {
    this.document.removeEventListener(
      'visibilitychange',
      this.visibilityChange
    );
    this.pause();
    this.trendRequest?.unsubscribe();
    this.compareRequest?.unsubscribe();
    this.formChanges.unsubscribe();
    this.trendChanges.unsubscribe();
  }

  private showFrame(index: number): void {
    const frame = this.frames()[index];
    if (!this.playbackEnabled() || !frame || frame.count === null) {
      this.pause();
      return;
    }
    clearTimeout(this.timer);
    clearTimeout(this.watchdog);
    this.activeIndex.set(index);
    this.playbackError.set(null);
    this.frameChange.emit({
      afterDate: frame.afterDate,
      beforeDate: frame.beforeDate,
    });
    this.watchdog = setTimeout(() => {
      this.pause();
      this.playbackError.set(
        'Tempo esgotado. Selecione o mês para tentar novamente.'
      );
    }, 30000);
  }

  private scheduleNext(): void {
    clearTimeout(this.timer);
    if (!this.playing()) return;
    this.timer = setTimeout(() => {
      const next = this.frames().findIndex(
        (frame, index) =>
          frame.count !== null && index > (this.activeIndex() ?? -1)
      );
      if (next === -1) this.pause();
      else this.showFrame(next);
    }, 1500);
  }

  private clearComparison(): void {
    this.compareRequest?.unsubscribe();
    this.comparing.set(false);
    this.results.set(null);
    this.comparable.set(null);
    this.comparisonError.set(null);
  }

  readonly coverageEnd = computed(
    () => [this.coverage().latest ?? '', previousDay(brazilToday())].sort()[0]
  );
}
