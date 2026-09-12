import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent, within } from 'storybook/test';
import {
  MapStoryArgs,
  MapStoryHarnessComponent,
} from '../../../../testing/map-story-harness.component';

const meta = {
  title: 'Mapa/Censo/Mapa fictício',
  component: MapStoryHarnessComponent,
  parameters: { layout: 'fullscreen' },
  args: {
    mode: 'markers',
    categories: ['Furto', 'Roubo'],
    afterDate: '2026-01-01',
    beforeDate: '2026-08-31',
  },
} satisfies Meta<MapStoryHarnessComponent>;
export default meta;
type Story = StoryObj<MapStoryArgs>;

async function enableLayer(canvasElement: HTMLElement, label: string) {
  const canvas = within(canvasElement);
  await userEvent.click(
    canvas.getByRole('button', { name: 'Limites e Censo' })
  );
  await userEvent.click(
    await canvas.findByRole('combobox', { name: 'Limites territoriais' })
  );
  await userEvent.click(
    within(canvasElement.ownerDocument.body).getByRole('option', {
      name: label,
    })
  );
  return canvas;
}

export const Bairros: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await enableLayer(canvasElement, 'Bairros oficiais');
    await userEvent.click(
      canvas.getByRole('button', { name: 'Fechar limites e Censo' })
    );
    await expect(
      await canvas.findByText('Censo fictício - Storybook')
    ).toBeVisible();
  },
};
export const Municipio: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await enableLayer(canvasElement, 'Municípios');
    await userEvent.click(
      canvas.getByRole('button', { name: 'Fechar limites e Censo' })
    );
    await expect(
      await canvas.findByText('Censo fictício - Storybook')
    ).toBeVisible();
  },
};
export const DialogoDoBairro: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await enableLayer(canvasElement, 'Bairros oficiais');
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Buscar bairro' }),
      'demo'
    );
    await userEvent.click(
      await canvas.findByRole('button', { name: /Bairro de demonstração/ })
    );
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog')
    );
    await expect(
      dialog.getByRole('heading', { name: 'Bairro de demonstração' })
    ).toBeVisible();
    await expect(dialog.getByText('250,0')).toBeVisible();
    await expect(
      dialog.getByText('Cor ou raça', { exact: true })
    ).toBeVisible();
  },
};
