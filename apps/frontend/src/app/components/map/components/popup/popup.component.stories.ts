import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';
import { GroupedOccurrence } from '@mapa-criminalidade/shared-types';
import { storyGroupedOccurrences } from '../../../../testing/storybook.fixtures';
import { PopupComponent } from './popup.component';

const sparseGroups: GroupedOccurrence[] = [
  {
    ...storyGroupedOccurrences[0],
    occurrences: [
      {
        ...storyGroupedOccurrences[0].occurrences[0],
        naturezaApurada: null,
        logradouro: null,
        numeroLogradouro: null,
        bairro: null,
        cidade: null,
        localTipo: null,
        dataRegistro: null,
        conduta: null,
      },
    ],
  },
];

const meta = {
  title: 'Mapa/Popup de ocorrência',
  component: PopupComponent,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    groupedOccurrences: { control: 'object' },
  },
  args: {
    groupedOccurrences: storyGroupedOccurrences,
    closed: fn(),
  },
} satisfies Meta<PopupComponent>;

export default meta;
type Story = StoryObj<{
  groupedOccurrences: GroupedOccurrence[];
  closed: () => void;
}>;

export const Playground: Story = {};

export const UmaOcorrencia: Story = {
  args: {
    groupedOccurrences: [
      {
        ...storyGroupedOccurrences[0],
        occurrences: [storyGroupedOccurrences[0].occurrences[0]],
      },
    ],
  },
};

export const VariasOcorrencias: Story = {
  args: {
    groupedOccurrences: [storyGroupedOccurrences[0]],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('1 / 2')).toBeInTheDocument();
    const next = canvas
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('▸'));
    if (!next) throw new Error('Botão da próxima ocorrência não encontrado.');
    await userEvent.click(next);
    await expect(canvas.getByText('2 / 2')).toBeInTheDocument();
  },
};

export const VariosBoletins: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText('1 / 2')).toHaveLength(2);
  },
};

export const DadosParciais: Story = {
  args: {
    groupedOccurrences: sparseGroups,
  },
};

export const SemOcorrencias: Story = {
  args: {
    groupedOccurrences: [],
  },
};
