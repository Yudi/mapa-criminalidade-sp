import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator, moduleMetadata } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NEVER, of, throwError } from 'rxjs';
import {
  MapFeatureFilterInput,
  MapFeatureTemporalStats,
} from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../shared/occurrences.service';
import {
  storyDateRange,
  storyTemporalComparison,
  storyTemporalTrend,
} from '../../testing/storybook.fixtures';
import { TemporalMapState } from './temporal-analysis.utils';
import { TemporalAnalysisComponent } from './temporal-analysis.component';

type TemporalDataState =
  | 'loaded'
  | 'loading'
  | 'empty'
  | 'trend-error'
  | 'comparison-error'
  | 'revision-mismatch';

interface TemporalStoryArgs {
  dataState: TemporalDataState;
  area: boolean;
  partialCoverage: boolean;
  playbackEnabled: boolean;
  mapStatus: TemporalMapState['status'];
}

function temporalFilter(area: boolean): MapFeatureFilterInput {
  return {
    categories: ['Furto', 'Roubo', 'Estelionato'],
    afterDate: '2026-01-01',
    beforeDate: '2026-08-31',
    ...(area
      ? {
          area: {
            longitude: -46.63331,
            latitude: -23.55052,
            radius: 750,
          },
        }
      : {
          bounds: {
            minLon: -46.69,
            minLat: -23.59,
            maxLon: -46.58,
            maxLat: -23.51,
          },
        }),
  };
}

function temporalService(state: TemporalDataState) {
  let requestCount = 0;

  return {
    getTemporalStats: (): ReturnType<
      OccurrencesService['getTemporalStats']
    > => {
      requestCount += 1;

      if (state === 'loading') return NEVER;
      if (state === 'trend-error' && requestCount === 1) {
        return throwError(() => new Error('Falha fictícia na evolução'));
      }
      if (state === 'comparison-error' && requestCount > 1) {
        return throwError(() => new Error('Falha fictícia na comparação'));
      }

      if (requestCount === 1) {
        if (state === 'empty') {
          const empty: MapFeatureTemporalStats = {
            datasetRevision: storyTemporalTrend.datasetRevision,
            total: 0,
            monthly: [],
            categories: [],
          };
          return of(empty);
        }
        return of(storyTemporalTrend);
      }

      const current = requestCount % 2 === 1;
      const comparison = storyTemporalComparison(current);
      return of(
        state === 'revision-mismatch' && current
          ? { ...comparison, datasetRevision: 'storybook-newer-revision' }
          : comparison
      );
    },
  };
}

const meta = {
  title: 'Análises/Análise temporal',
  component: TemporalAnalysisComponent,
  decorators: [
    moduleMetadata({ imports: [TemporalAnalysisComponent] }),
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--wide">${story}</div>`
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    dataState: {
      control: 'select',
      options: [
        'loaded',
        'loading',
        'empty',
        'trend-error',
        'comparison-error',
        'revision-mismatch',
      ],
    },
    area: { control: 'boolean' },
    partialCoverage: { control: 'boolean' },
    playbackEnabled: { control: 'boolean' },
    mapStatus: {
      control: 'select',
      options: ['ready', 'loading', 'error'],
    },
  },
  args: {
    dataState: 'loaded',
    area: false,
    partialCoverage: false,
    playbackEnabled: true,
    mapStatus: 'ready',
  },
  render: (args) => ({
    props: {
      filter: temporalFilter(args.area),
      coverage: args.partialCoverage
        ? { ...storyDateRange, latest: '2026-08-17' }
        : storyDateRange,
      playbackEnabled: args.playbackEnabled,
      mapState: {
        after: '2026-08-01',
        before: '2026-08-31',
        status: args.mapStatus,
      } satisfies TemporalMapState,
      frameChange: fn(),
      close: fn(),
      focusMap: fn(),
    },
    applicationConfig: {
      providers: [
        {
          provide: OccurrencesService,
          useValue: temporalService(args.dataState),
        },
      ],
    },
    template: `
      <app-temporal-analysis
        [filter]="filter"
        [coverage]="coverage"
        [playbackEnabled]="playbackEnabled"
        [mapState]="mapState"
        (frameChange)="frameChange($event)"
        (closed)="close()"
        (focusMap)="focusMap()"
      />
    `,
  }),
} satisfies Meta<TemporalStoryArgs>;

export default meta;
type Story = StoryObj<TemporalStoryArgs>;

export const Playground: Story = {};

export const ComparacaoMensal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Comparar' }));
    await expect(await canvas.findByText(/Ocorrências: A/)).toBeInTheDocument();
    await expect(
      canvas.getByRole('table', { name: /Variação de B/ })
    ).toBeInTheDocument();
  },
};

export const AreaSelecionada: Story = {
  args: {
    area: true,
  },
};

export const EvolucaoComZerosEParcial: Story = {
  args: {
    partialCoverage: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Evolução' }));
    await expect(
      await canvas.findByText('Ocorrências por mês')
    ).toBeInTheDocument();
    await expect(canvas.getByText(/mês parcial/)).toBeInTheDocument();
  },
};

export const SemOcorrencias: Story = {
  args: {
    dataState: 'empty',
  },
};

export const Carregando: Story = {
  args: {
    dataState: 'loading',
  },
};

export const ErroNaEvolucao: Story = {
  args: {
    dataState: 'trend-error',
  },
};

export const ErroNaComparacao: Story = {
  args: {
    dataState: 'comparison-error',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Comparar' }));
    await expect(
      await canvas.findByText('Falha na comparação. Tente novamente.')
    ).toBeInTheDocument();
  },
};

export const RevisaoAlterada: Story = {
  args: {
    dataState: 'revision-mismatch',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Comparar' }));
    await expect(
      await canvas.findByText('Dados atualizados. Compare novamente.')
    ).toBeInTheDocument();
  },
};

export const ReproducaoDesabilitada: Story = {
  args: {
    playbackEnabled: false,
  },
};
