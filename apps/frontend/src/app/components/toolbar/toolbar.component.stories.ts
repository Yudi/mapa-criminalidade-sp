import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { ToolbarComponent } from './toolbar.component';

interface ToolbarStoryArgs {
  showIndeterminate: boolean;
  progress: number;
}

const openDialog = fn();

const meta = {
  title: 'Navegação/Barra superior',
  component: ToolbarComponent,
  decorators: [moduleMetadata({ imports: [ToolbarComponent] })],
  argTypes: {
    showIndeterminate: { control: 'boolean' },
    progress: { control: { type: 'range', min: -1, max: 100, step: 1 } },
  },
  args: {
    showIndeterminate: false,
    progress: -1,
  },
  render: (args) => ({
    props: {
      showIndeterminateProgressBar: signal(args.showIndeterminate),
      progressBarPercentage: signal(args.progress),
    },
    applicationConfig: {
      providers: [
        {
          provide: MatDialog,
          useValue: { open: openDialog },
        },
      ],
    },
    template: `
      <app-toolbar
        [showIndeterminateProgressBar]="showIndeterminateProgressBar"
        [progressBarPercentage]="progressBarPercentage"
      />
    `,
  }),
} satisfies Meta<ToolbarStoryArgs>;

export default meta;
type Story = StoryObj<ToolbarStoryArgs>;

export const Playground: Story = {};

export const Inativa: Story = {};

export const CarregamentoIndeterminado: Story = {
  args: {
    showIndeterminate: true,
  },
};

export const Progresso: Story = {
  args: {
    progress: 42,
  },
};

export const Concluido: Story = {
  args: {
    progress: 100,
  },
};

export const AcaoDeInformacoes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    openDialog.mockClear();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Informações do projeto' })
    );
    await waitFor(() => expect(openDialog).toHaveBeenCalled());
  },
};
