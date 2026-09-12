import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator, moduleMetadata } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';
import { of } from 'rxjs';
import {
  CategoryInfo,
  DateRange,
  PeriodInfo,
} from '@mapa-criminalidade/shared-types';
import {
  storyCategories,
  storyDateRange,
  storyPeriods,
} from '../../testing/storybook.fixtures';
import { CardComponent } from './card.component';

interface CardStoryArgs {
  rubricas: CategoryInfo[];
  periods: PeriodInfo[];
  dateRange: DateRange | null;
  selectedRubricas: Record<string, boolean> | undefined;
  detailEntries: Array<{
    key: 'vehicleBrands' | 'objectTypes' | 'locationTypes';
    label: string;
    value: string;
    displayValue: string;
  }>;
  statsUnavailable: boolean;
  analysisAreaSelected: boolean;
  canOpenVisibleCharts: boolean;
  viewportStatsLoading: boolean;
  showTemporalAnalysis: boolean;
  canOpenTemporalAnalysis: boolean;
}

const meta = {
  title: 'Filtros/Painel principal',
  component: CardComponent,
  decorators: [
    moduleMetadata({ imports: [CardComponent] }),
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--form">${story}</div>`
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    rubricas: { control: 'object' },
    periods: { control: 'object' },
    dateRange: { control: 'object' },
    selectedRubricas: { control: 'object' },
    detailEntries: { control: 'object' },
    statsUnavailable: { control: 'boolean' },
    analysisAreaSelected: { control: 'boolean' },
    canOpenVisibleCharts: { control: 'boolean' },
    viewportStatsLoading: { control: 'boolean' },
  },
  args: {
    rubricas: storyCategories,
    periods: storyPeriods,
    dateRange: storyDateRange,
    selectedRubricas: {
      Furto: true,
      Roubo: true,
      Estelionato: false,
      'Veículos recuperados': false,
    },
    detailEntries: [],
    statsUnavailable: false,
    analysisAreaSelected: false,
    canOpenVisibleCharts: true,
    viewportStatsLoading: false,
    showTemporalAnalysis: true,
    canOpenTemporalAnalysis: true,
  },
  render: (args) => ({
    props: {
      ...args,
      rubricas$: of(args.rubricas),
      periods$: of(args.periods),
      submit: fn(),
      rubricasChange: fn(),
      periodChange: fn(),
      hourChange: fn(),
      visibleCharts: fn(),
      removeDetail: fn(),
      temporalAnalysis: fn(),
    },
    template: `
      <app-card
        [showTemporalAnalysis]="showTemporalAnalysis"
        [canOpenTemporalAnalysis]="canOpenTemporalAnalysis"
        (temporalAnalysisEvent)="temporalAnalysis()"
        [rubricas]="rubricas$"
        [periods]="periods$"
        [dateRange]="dateRange"
        [selectedRubricas]="selectedRubricas"
        [detailEntries]="detailEntries"
        [statsUnavailable]="statsUnavailable"
        [analysisAreaSelected]="analysisAreaSelected"
        [canOpenVisibleCharts]="canOpenVisibleCharts"
        [viewportStatsLoading]="viewportStatsLoading"
        (submitEvent)="submit($event)"
        (rubricasFormEvent)="rubricasChange($event)"
        (periodFilterEvent)="periodChange($event)"
        (hourFilterEvent)="hourChange($event)"
        (visibleChartsEvent)="visibleCharts()"
        (removeDetailEvent)="removeDetail($event)"
      />
    `,
  }),
} satisfies Meta<CardStoryArgs>;

export default meta;
type Story = StoryObj<CardStoryArgs>;

export const Playground: Story = {};

export const DadosCompletos: Story = {};

export const SemMetadados: Story = {
  args: {
    rubricas: [],
    periods: [],
    selectedRubricas: {},
    canOpenVisibleCharts: false,
  },
};

export const EstatisticasIndisponiveis: Story = {
  args: {
    statsUnavailable: true,
  },
};

export const RubricaSelecionadaForaDoMapa: Story = {
  args: {
    rubricas: storyCategories.filter((category) => category.name !== 'Roubo'),
    selectedRubricas: {
      Furto: false,
      Roubo: true,
    },
  },
};

export const AreaSelecionada: Story = {
  args: {
    analysisAreaSelected: true,
  },
};

export const FiltrosDeDetalheAtivos: Story = {
  args: {
    detailEntries: [
      {
        key: 'vehicleBrands',
        label: 'Marca de veículo',
        value: 'VW',
        displayValue: 'VW',
      },
      {
        key: 'objectTypes',
        label: 'Tipo de objeto',
        value: 'Telefone celular',
        displayValue: 'Telefone celular',
      },
      {
        key: 'locationTypes',
        label: 'Tipo de local',
        value: 'Via pública',
        displayValue: 'Via pública',
      },
    ],
  },
};

export const AtualizandoEstatisticas: Story = {
  args: {
    viewportStatsLoading: true,
  },
};

export const SelecaoDeRubricas: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const clearButton = canvas.getByRole('button', {
      name: /Desmarcar todas/i,
    });
    await userEvent.click(clearButton);
    await expect(
      canvas.getByRole('button', { name: /Selecionar todas/i })
    ).toBeInTheDocument();
  },
};

export const EnderecoPreenchido: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByText('Buscar endereço', { selector: 'summary span' })
    );
    await userEvent.type(
      canvas.getByLabelText('Nome da via e número'),
      'Praça fictícia, 100'
    );
    await userEvent.type(canvas.getByLabelText('Cidade'), 'São Paulo');
    await expect(
      canvas.getByRole('button', { name: /Buscar endereço/i })
    ).toBeEnabled();
  },
};

export const IntervaloDeDatasInvalido: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const start = canvas.getByLabelText('Início');
    const end = canvas.getByLabelText('Fim');
    await userEvent.clear(start);
    await userEvent.type(start, '31/08/2026');
    await userEvent.clear(end);
    await userEvent.type(end, '01/01/2026');
    await expect(
      canvas.getByRole('button', { name: /Atualizar pesquisa/i })
    ).toBeDisabled();
  },
};

export const FiltroDeHorarioAtivo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByText('Período e horário', {
        exact: false,
        selector: 'summary span',
      })
    );
    await userEvent.click(canvas.getByLabelText('Filtrar por horário'));
    await expect(canvas.getByLabelText('De')).toBeEnabled();
    await expect(canvas.getByLabelText('Até')).toBeEnabled();
  },
};
