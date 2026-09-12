import { MatDialogRef } from '@angular/material/dialog';
import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';
import { TileTimeoutDialogComponent } from './tile-timeout-dialog.component';

const closeDialog = fn();

const meta = {
  title: 'Mapa/Tempo limite dos blocos',
  component: TileTimeoutDialogComponent,
  decorators: [
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--dialog">${story}</div>`
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  render: () => ({
    applicationConfig: {
      providers: [
        {
          provide: MatDialogRef,
          useValue: { close: closeDialog },
        },
      ],
    },
  }),
} satisfies Meta<TileTimeoutDialogComponent>;

export default meta;
type Story = StoryObj<TileTimeoutDialogComponent>;

export const Playground: Story = {
  play: async ({ canvasElement }) => {
    closeDialog.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'OK' }));
    await expect(closeDialog).toHaveBeenCalled();
  },
};
