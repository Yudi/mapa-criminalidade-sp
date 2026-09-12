import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent, within } from 'storybook/test';
import { StorybookPageShellComponent } from './testing/storybook-page-shell.component';

const meta = {
  title: 'Páginas/Mapa com filtros',
  component: StorybookPageShellComponent,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    mode: { control: 'select', options: ['auto', 'markers', 'density'] },
    dataState: {
      control: 'select',
      options: ['loaded', 'empty', 'partial', 'error', 'rate-limited'],
    },
    areaState: {
      control: 'select',
      options: ['none', 'radius', 'controls', 'drawing', 'error'],
    },
    initialCategories: {
      control: 'check',
      options: ['Furto', 'Roubo', 'Estelionato', 'Veículos recuperados'],
    },
    initialDetailEntries: { control: 'object' },
    statsUnavailable: { control: 'boolean' },
    viewportStatsLoading: { control: 'boolean' },
    radius: { control: { type: 'range', min: 1, max: 10_000, step: 50 } },
  },
  args: {
    mode: 'auto',
    dataState: 'loaded',
    areaState: 'none',
    initialCategories: [
      'Furto',
      'Roubo',
      'Estelionato',
      'Veículos recuperados',
    ],
    initialDetailEntries: [],
    statsUnavailable: false,
    viewportStatsLoading: false,
    radius: 750,
  },
} satisfies Meta<StorybookPageShellComponent>;

export default meta;
type Story = StoryObj<StorybookPageShellComponent>;

export const Playground: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByLabelText('Mapa: clique para adicionar vértices da área')
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByLabelText(/Roubo.*736/));
  },
};

export const Densidade: Story = { args: { mode: 'density' } };

export const AreaSelecionadaComFiltros: Story = {
  args: {
    areaState: 'radius',
    initialCategories: ['Furto', 'Roubo'],
    initialDetailEntries: [
      { key: 'vehicleBrands', label: 'Marca de veículo', value: 'VW' },
      {
        key: 'objectTypes',
        label: 'Tipo de objeto',
        value: 'TELEFONE CELULAR',
      },
    ],
  },
};

export const AtualizandoEstatisticas: Story = {
  args: { viewportStatsLoading: true },
};

export const EstatisticasIndisponiveis: Story = {
  args: { statsUnavailable: true },
};

export const ErroParcialDoMapa: Story = {
  args: { dataState: 'error' },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
