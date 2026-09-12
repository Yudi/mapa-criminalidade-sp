import type { Meta, StoryObj } from '@storybook/angular';
import { expect, within } from 'storybook/test';
import {
  MapStoryArgs,
  MapStoryHarnessComponent,
} from '../../testing/map-story-harness.component';

const meta = {
  title: 'Mapa/Mapa principal',
  component: MapStoryHarnessComponent,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    mode: {
      control: 'select',
      options: ['auto', 'markers', 'density', 'heatmap'],
    },
    dataState: {
      control: 'select',
      options: ['loaded', 'empty', 'partial', 'error', 'rate-limited'],
    },
    areaState: {
      control: 'select',
      options: ['none', 'radius', 'controls', 'drawing', 'error'],
    },
    categories: {
      control: 'check',
      options: ['Furto', 'Roubo', 'Estelionato', 'Veículos recuperados'],
    },
    afterDate: { control: 'text' },
    beforeDate: { control: 'text' },
    period: {
      control: 'select',
      options: [null, 'Pela manhã', 'À tarde', 'À noite', 'De madrugada'],
    },
    hourFilterEnabled: { control: 'boolean' },
    startHour: { control: { type: 'range', min: 0, max: 23, step: 1 } },
    endHour: { control: { type: 'range', min: 0, max: 23, step: 1 } },
    datasetRevision: { control: 'text' },
    longitude: { control: { type: 'number', step: 0.0001 } },
    latitude: { control: { type: 'number', step: 0.0001 } },
    radius: { control: { type: 'range', min: 1, max: 10_000, step: 50 } },
    vehicleBrands: { control: 'object' },
    objectTypes: { control: 'object' },
    locationTypes: { control: 'object' },
    embedded: { table: { disable: true } },
    areaChange: { table: { disable: true } },
  },
  args: {
    mode: 'auto',
    dataState: 'loaded',
    areaState: 'none',
    categories: ['Furto', 'Roubo', 'Estelionato', 'Veículos recuperados'],
    afterDate: '2026-01-01',
    beforeDate: '2026-08-31',
    period: null,
    hourFilterEnabled: false,
    startHour: 8,
    endHour: 19,
    datasetRevision: 'storybook-2026-09-12',
    longitude: -46.63331,
    latitude: -23.55052,
    radius: 750,
    vehicleBrands: [],
    objectTypes: [],
    locationTypes: [],
  },
} satisfies Meta<MapStoryHarnessComponent>;

export default meta;
type Story = StoryObj<MapStoryArgs>;

export const Playground: Story = {};

export const MarcadoresEAgrupamentos: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByLabelText('Mapa: clique para adicionar vértices da área')
    ).toBeInTheDocument();
  },
};

export const MarcadoresIndividuais: Story = { args: { mode: 'markers' } };

export const MapaDeCalor: Story = {
  args: { mode: 'heatmap' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Menor')).toBeInTheDocument();
    await expect(within(canvasElement).getByText('Maior')).toBeInTheDocument();
  },
};

export const MapaDeCalorSemDados: Story = {
  args: { mode: 'heatmap', dataState: 'empty' },
};

export const DensidadeEmTodasAsFaixas: Story = {
  args: { mode: 'density' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('1.000+')).toBeInTheDocument();
  },
};

export const SemDados: Story = { args: { dataState: 'empty' } };
export const SemCategorias: Story = { args: { categories: [] } };
export const RepresentacaoParcial: Story = { args: { dataState: 'partial' } };
export const ErroDeCarregamento: Story = { args: { dataState: 'error' } };
export const LimiteDoServidor: Story = {
  args: { dataState: 'rate-limited' },
};
export const RaioSelecionado: Story = { args: { areaState: 'radius' } };
export const ControlesDeArea: Story = { args: { areaState: 'controls' } };
export const DesenhandoPoligono: Story = { args: { areaState: 'drawing' } };
export const AreaInvalida: Story = { args: { areaState: 'error' } };

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
