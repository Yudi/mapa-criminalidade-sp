import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { ECharts, EChartsOption } from 'echarts';
import * as echarts from 'echarts';
import { MapFeatureChartBucket } from '@mapa-criminalidade/shared-types';

import { DetailFilterKey } from '../../../../shared/map-detail-filters';

export type ChartDisplayType = 'bar' | 'pie' | 'line';
export type ChartFilterKey = DetailFilterKey | 'categories';
export type ChartFilterValue = string | number;

export interface VisibleMapChartConfig {
  title: string;
  subtitle: string;
  icon: string;
  displayType: ChartDisplayType;
  buckets: MapFeatureChartBucket[];
  amountLabel?: string;
  emptyText?: string;
  missingLabels?: string[];
  compact?: boolean;
  filterKey?: ChartFilterKey;
  selectedValues?: ChartFilterValue[];
}

@Component({
  selector: 'app-chart-card',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './chart-card.component.html',
  styleUrl: './chart-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartCardComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly config = input.required<VisibleMapChartConfig>();
  readonly busy = input(false);
  readonly bucketSelect = output<{
    key: ChartFilterKey;
    value: ChartFilterValue;
  }>();

  filterValue(bucket: MapFeatureChartBucket): ChartFilterValue | null {
    const key = this.config().filterKey;
    if (key === 'categories') return bucket.label;
    if (key === 'weekdays') {
      const weekday = Number(bucket.filterValue);
      return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7
        ? weekday
        : null;
    }
    return bucket.filterValue ?? null;
  }

  selectBucket(bucket: MapFeatureChartBucket): void {
    if (this.busy()) return;
    const key = this.config().filterKey;
    const value = this.filterValue(bucket);
    if (key && value) this.bucketSelect.emit({ key, value });
  }

  @ViewChild('chartHost')
  private chartHost?: ElementRef<HTMLDivElement>;

  private chart: ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private readonly colorSchemeQuery =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  private readonly handleColorSchemeChange = () => this.refreshTheme();

  ngAfterViewInit(): void {
    this.renderChart();

    if (this.chartHost?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(this.chartHost.nativeElement);
    }

    this.observeThemeChanges();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && this.chartHost) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.colorSchemeQuery?.removeEventListener(
      'change',
      this.handleColorSchemeChange
    );
    this.chart?.dispose();
  }

  hasData(): boolean {
    return this.config().buckets.length > 0;
  }

  private renderChart(): void {
    const host = this.chartHost?.nativeElement;
    if (!host) return;

    if (!this.chart) {
      this.chart = echarts.init(host, undefined, { renderer: 'canvas' });
      this.chart.on('click', (event) => {
        if (
          event.componentType !== 'series' ||
          typeof event.dataIndex !== 'number'
        )
          return;
        const bucket = this.config().buckets[event.dataIndex];
        if (bucket) this.selectBucket(bucket);
      });
    }

    this.chart.setOption(this.buildOption(), true);
  }

  private refreshTheme(): void {
    if (!this.chart) return;

    this.chart.setOption(this.buildOption(), true);
    this.chart.resize();
  }

  private observeThemeChanges(): void {
    this.themeObserver = new MutationObserver(() => this.refreshTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    this.colorSchemeQuery?.addEventListener(
      'change',
      this.handleColorSchemeChange
    );
  }

  private buildOption(): EChartsOption {
    const config = this.config();
    const colors = this.readThemeColors();
    const chartData = config.buckets.map((bucket, index) => {
      const color = colors.series[index % colors.series.length];

      return {
        name: bucket.label,
        value: bucket.count,
        amount: bucket.amount,
        itemStyle: {
          color,
          opacity:
            config.selectedValues?.length &&
            !config.selectedValues.includes(this.filterValue(bucket) ?? '')
              ? 0.4
              : 1,
        },
        emphasis: {
          itemStyle: {
            color,
            shadowBlur: 12,
            shadowColor: colors.shadow,
          },
        },
      };
    });

    if (config.displayType === 'line') {
      return {
        animation: false,
        textStyle: { color: colors.onSurface, fontFamily: colors.fontFamily },
        tooltip: this.tooltip(colors),
        grid: { left: 8, right: 16, top: 24, bottom: 48, containLabel: true },
        xAxis: {
          type: 'category',
          data: config.buckets.map((bucket) => bucket.label),
          axisLabel: { color: colors.onSurfaceVariant, hideOverlap: true },
        },
        yAxis: {
          type: 'value',
          minInterval: 1,
          axisLabel: { color: colors.onSurfaceVariant },
          splitLine: { lineStyle: { color: colors.outlineVariant } },
        },
        dataZoom: [
          {
            type: 'slider',
            bottom: 0,
            height: 20,
            textStyle: { color: colors.onSurfaceVariant },
          },
        ],
        series: [
          {
            type: 'line',
            data: config.buckets.map((bucket) => ({
              name: bucket.label,
              value: config.missingLabels?.includes(bucket.label)
                ? null
                : bucket.count,
            })),
            itemStyle: { color: colors.series[0] },
            lineStyle: { color: colors.series[0] },
            symbolSize: 6,
          },
        ],
      };
    }

    if (config.displayType === 'pie') {
      return {
        animation: !config.filterKey,
        color: colors.series,
        textStyle: {
          color: colors.onSurface,
          fontFamily: colors.fontFamily,
        },
        tooltip: this.tooltip(colors),
        legend: {
          bottom: 0,
          type: 'scroll',
          selectedMode: config.filterKey ? false : true,
          textStyle: { color: colors.onSurfaceVariant },
        },
        series: [
          {
            type: 'pie',
            cursor: config.filterKey ? 'pointer' : 'default',
            radius: ['48%', '72%'],
            center: ['50%', '42%'],
            avoidLabelOverlap: true,
            itemStyle: {
              borderColor: colors.surface,
              borderWidth: 2,
            },
            emphasis: {
              scale: true,
              itemStyle: {
                borderColor: colors.surface,
                borderWidth: 3,
                shadowBlur: 12,
                shadowColor: colors.shadow,
              },
            },
            label: {
              color: colors.onSurface,
              formatter: '{b}',
            },
            labelLine: {
              lineStyle: { color: colors.outline },
            },
            data: chartData,
          },
        ],
      };
    }

    const labels = config.buckets.map((bucket) => bucket.label);

    return {
      animation: !config.filterKey,
      color: colors.series,
      textStyle: {
        color: colors.onSurface,
        fontFamily: colors.fontFamily,
      },
      tooltip: this.tooltip(colors),
      grid: {
        left: 8,
        right: 24,
        top: 16,
        bottom: 12,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: colors.onSurfaceVariant },
        splitLine: { lineStyle: { color: colors.outlineVariant } },
      },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        axisLabel: {
          color: colors.onSurfaceVariant,
          width: 120,
          overflow: 'truncate',
        },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: colors.outlineVariant } },
      },
      series: [
        {
          type: 'bar',
          cursor: config.filterKey ? 'pointer' : 'default',
          data: chartData,
          barMaxWidth: 18,
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 8,
              shadowColor: colors.shadow,
            },
          },
          label: {
            show: true,
            position: 'right',
            color: colors.onSurfaceVariant,
          },
        },
      ],
    };
  }

  private tooltip(colors: ChartThemeColors): EChartsOption['tooltip'] {
    return {
      trigger: 'item',
      backgroundColor: colors.surfaceContainer,
      borderColor: colors.outlineVariant,
      textStyle: {
        color: colors.onSurface,
        fontFamily: colors.fontFamily,
      },
      valueFormatter: (value) => this.formatNumber(Number(value)),
      formatter: (params) => {
        if (!this.isTooltipParam(params)) return '';

        const bucket = this.config().buckets.find(
          (item) => item.label === params.name
        );
        const name = this.escapeHtml(params.name);
        const amountLabel = this.escapeHtml(
          this.config().amountLabel ?? 'Quantidade'
        );
        const count = this.formatNumber(params.value);
        const amount =
          bucket?.amount !== null && bucket?.amount !== undefined
            ? `<br/>${amountLabel}: ${this.formatNumber(bucket.amount)}`
            : '';

        return `<strong>${name}</strong><br/>Ocorrências: ${count}${amount}`;
      },
    };
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      switch (character) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  private isTooltipParam(
    value: unknown
  ): value is { name: string; value: number } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      'value' in value &&
      typeof value.name === 'string' &&
      typeof value.value === 'number'
    );
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: value % 1 === 0 ? 0 : 1,
    }).format(value);
  }

  private readThemeColors(): ChartThemeColors {
    const styles = getComputedStyle(document.body);
    const cssValue = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const color = (name: string, fallback: string) =>
      this.resolveCssColor(cssValue(name, fallback), fallback);

    return {
      fontFamily: cssValue('font-family', 'Inter Variable, sans-serif'),
      surface: color('--mat-sys-surface', '#ffffff'),
      surfaceContainer: color('--mat-sys-surface-container', '#f3f4f8'),
      onSurface: color('--mat-sys-on-surface', '#1a1b1f'),
      onSurfaceVariant: color('--mat-sys-on-surface-variant', '#44474e'),
      outline: color('--mat-sys-outline', '#74777f'),
      outlineVariant: color('--mat-sys-outline-variant', '#c4c6d0'),
      shadow: this.resolveCssColor('rgb(0 0 0 / 0.28)', 'rgba(0, 0, 0, 0.28)'),
      series: [
        color('--mat-sys-primary', '#005cbb'),
        color('--mat-sys-tertiary', '#33618d'),
        color('--mat-sys-secondary', '#565e71'),
        color('--mat-sys-error', '#ba1a1a'),
        this.resolveCssColor('#2e7d32', '#2e7d32'),
        this.resolveCssColor('#ef6c00', '#ef6c00'),
        this.resolveCssColor('#6a1b9a', '#6a1b9a'),
        this.resolveCssColor('#00838f', '#00838f'),
      ],
    };
  }

  private resolveCssColor(color: string, fallback: string): string {
    const probe = document.createElement('span');
    probe.style.color = color;

    if (!probe.style.color) {
      return fallback;
    }

    probe.style.display = 'none';
    document.body.appendChild(probe);

    const resolvedColor = getComputedStyle(probe).color;
    probe.remove();

    return resolvedColor || fallback;
  }
}

interface ChartThemeColors {
  fontFamily: string;
  surface: string;
  surfaceContainer: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  shadow: string;
  series: string[];
}
