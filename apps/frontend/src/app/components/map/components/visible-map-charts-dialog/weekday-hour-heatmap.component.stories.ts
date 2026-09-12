import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import { expect, within } from 'storybook/test';
import { WeekdayHourBucket } from '@mapa-criminalidade/shared-types';
import { storyWeekdayHours } from '../../../../testing/storybook.fixtures';
import { WeekdayHourHeatmapComponent } from './weekday-hour-heatmap.component';

const meta = {
  title: 'Análises/Mapa de calor por dia e hora',
  component: WeekdayHourHeatmapComponent,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--wide">${story}</div>`
    ),
  ],
  argTypes: {
    buckets: { control: 'object' },
    busy: { control: 'boolean' },
  },
  args: {
    buckets: storyWeekdayHours,
    busy: false,
  },
} satisfies Meta<WeekdayHourHeatmapComponent>;

export default meta;
type Story = StoryObj<{
  buckets: WeekdayHourBucket[];
  busy: boolean;
}>;

export const Playground: Story = {};

export const TodosOsNiveis: Story = {
  args: {
    buckets: [1, 2, 3, 4, 5].map((count, index) => ({
      weekday: 1,
      hour: index + 8,
      count,
    })),
  },
};

export const MeiaNoiteEDomingoANoite: Story = {
  args: {
    buckets: [
      { weekday: 1, hour: 0, count: 2 },
      { weekday: 7, hour: 23, count: 3 },
      { weekday: 1, hour: null, count: 5 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('00h')).toBeInTheDocument();
    await expect(canvas.getByText('Hora incerta')).toBeInTheDocument();
    await expect(canvas.getByText(/Com data e hora: 5/)).toBeInTheDocument();
  },
};

export const ApenasHorariosIncertos: Story = {
  args: {
    buckets: [
      { weekday: 2, hour: null, count: 12 },
      { weekday: null, hour: 18, count: 7 },
      { weekday: null, hour: null, count: 4 },
    ],
  },
};

export const SemDados: Story = {
  args: {
    buckets: [],
  },
};

export const Ocupado: Story = {
  args: {
    busy: true,
  },
};
