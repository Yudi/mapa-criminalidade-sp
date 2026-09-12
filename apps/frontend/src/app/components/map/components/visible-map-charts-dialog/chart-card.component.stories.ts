import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import {
  ChartCardComponent,
  VisibleMapChartConfig,
} from './chart-card.component';

const barConfig: VisibleMapChartConfig = {
  title: 'Marcas de veículos',
  subtitle: 'Todas as categorias e anos-modelo da marca.',
  icon: 'directions_car',
  displayType: 'bar',
  filterKey: 'vehicleBrands',
  buckets: [
    { label: 'Volkswagen', filterValue: 'VW', count: 184 },
    { label: 'Chevrolet', filterValue: 'GM/CHEVROLET', count: 146 },
    { label: 'Fiat', filterValue: 'FIAT', count: 121 },
  ],
};

const meta = {
  title: 'Análises/Cartão de gráfico',
  component: ChartCardComponent,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--wide">${story}</div>`
    ),
  ],
  argTypes: {
    config: { control: 'object' },
    busy: { control: 'boolean' },
  },
  args: {
    config: barConfig,
    busy: false,
  },
} satisfies Meta<ChartCardComponent>;

export default meta;
type Story = StoryObj<{
  config: VisibleMapChartConfig;
  busy: boolean;
}>;

export const Playground: Story = {};

export const Barras: Story = {};

export const Pizza: Story = {
  args: {
    config: {
      ...barConfig,
      title: 'Distribuição por rubrica',
      subtitle: 'Categorias das ocorrências.',
      icon: 'donut_large',
      displayType: 'pie',
      filterKey: 'categories',
      buckets: [
        { label: 'Furto', count: 1_284 },
        { label: 'Roubo', count: 736 },
        { label: 'Estelionato', count: 318 },
      ],
    },
  },
};

export const LinhaComMesesSemCobertura: Story = {
  args: {
    config: {
      title: 'Ocorrências por mês',
      subtitle: '* mês parcial',
      icon: 'show_chart',
      displayType: 'line',
      compact: true,
      missingLabels: ['03/26'],
      buckets: [
        { label: '01/26', count: 82 },
        { label: '02/26', count: 71 },
        { label: '03/26', count: 0 },
        { label: '04/26*', count: 46 },
      ],
    },
  },
};

export const QuantidadesAgregadas: Story = {
  args: {
    config: {
      title: 'Entorpecentes',
      subtitle: 'Tipos e quantidade em gramas.',
      icon: 'medication',
      displayType: 'bar',
      amountLabel: 'Gramas',
      buckets: [
        { label: 'Maconha', count: 17, amount: 1_942 },
        { label: 'Cocaína', count: 22, amount: 684.5 },
      ],
    },
  },
};

export const ValorSelecionado: Story = {
  args: {
    config: {
      ...barConfig,
      selectedValues: ['VW', 'FIAT'],
    },
  },
};

export const Ocupado: Story = {
  args: {
    busy: true,
  },
};

export const SemDados: Story = {
  args: {
    config: {
      ...barConfig,
      buckets: [],
      emptyText: 'Nenhum veículo neste recorte',
    },
  },
};
