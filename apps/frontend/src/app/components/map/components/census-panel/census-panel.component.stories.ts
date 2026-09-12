import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import {
  CensusAreaDetail,
  CensusCrimeStats,
} from '@mapa-criminalidade/shared-types';
import { CensusPanelComponent } from './census-panel.component';

import {
  censusStoryArea,
  censusStoryMunicipality,
  censusStoryMissingIncome,
} from './census.fixtures';

const meta = {
  title: 'Mapa/Censo/Dados da área',
  component: CensusPanelComponent,
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div class="story-shell"><p>Dados fictícios para demonstração</p>${story}</div>`
    ),
  ],
  args: {
    area: censusStoryArea,
    crimes: {
      occurrences: 50,
      per100k: 250,
      after: '2026-01-01',
      before: '2026-08-31',
    },
    datesAvailable: true,
  },
} satisfies Meta<CensusPanelComponent>;
export default meta;
type Story = StoryObj<{
  area: CensusAreaDetail;
  crimes: CensusCrimeStats | null;
  loading: boolean;
  error: string | null;
  datesAvailable: boolean;
  applied: boolean;
}>;
export const Bairro: Story = {};
export const Municipio: Story = {
  args: {
    area: censusStoryMunicipality,
    crimes: {
      occurrences: 100,
      per100k: 250,
      after: '2026-01-01',
      before: '2026-08-31',
    },
  },
};
export const RendaIndisponivel: Story = {
  args: { area: censusStoryMissingIncome },
};
export const Carregando: Story = { args: { loading: true, crimes: null } };
export const Erro: Story = {
  args: { error: 'Falha ao consultar ocorrências.', crimes: null },
};
export const SemPopulacao: Story = {
  args: {
    area: {
      ...censusStoryArea,
      population: null,
      indicators: censusStoryArea.indicators.map((item) => ({
        ...item,
        value: item.key === 'population' ? null : item.value,
      })),
    },
    crimes: {
      occurrences: 50,
      per100k: null,
      after: '2026-01-01',
      before: '2026-08-31',
    },
  },
};
export const SemOcorrencias: Story = {
  args: {
    crimes: {
      occurrences: 0,
      per100k: 0,
      after: '2026-01-01',
      before: '2026-08-31',
    },
  },
};
export const SemPeriodo: Story = {
  args: { crimes: null, datesAvailable: false },
};
export const Aplicado: Story = { args: { applied: true } };
