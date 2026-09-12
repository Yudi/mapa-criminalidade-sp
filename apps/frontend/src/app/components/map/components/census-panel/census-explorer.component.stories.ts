import type { Meta, StoryObj } from '@storybook/angular';
import {
  applicationConfig,
  componentWrapperDecorator,
} from '@storybook/angular';
import { expect, within } from 'storybook/test';
import { CensusExplorerComponent } from './census-explorer.component';
import { CensusService } from '../../../../shared/census.service';
import { StoryCensusService } from '../../../../testing/story-census.service';

const meta = {
  title: 'Mapa/Censo/Explorar áreas',
  component: CensusExplorerComponent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div class="story-census-map"><p>Mapa de demonstração - dados fictícios</p>${story}</div>`
    ),
    applicationConfig({
      providers: [{ provide: CensusService, useClass: StoryCensusService }],
    }),
  ],
  args: {
    filter: {
      afterDate: '2026-01-01',
      beforeDate: '2026-08-31',
      categories: ['Furto'],
    },
  },
} satisfies Meta<CensusExplorerComponent>;
export default meta;
type Story = StoryObj;
export const BuscarBairro: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Limites e Censo' })
    );
    await userEvent.click(
      await canvas.findByRole('combobox', { name: 'Limites territoriais' })
    );
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('option', {
        name: 'Bairros oficiais',
      })
    );
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
      await dialog.findByRole('heading', { name: 'Bairro de demonstração' })
    ).toBeVisible();
    await expect(dialog.getByText('250,0')).toBeVisible();
    await expect(dialog.queryAllByRole('link')).toHaveLength(0);
  },
};
