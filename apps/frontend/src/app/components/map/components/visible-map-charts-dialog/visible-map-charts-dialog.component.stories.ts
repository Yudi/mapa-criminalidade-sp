import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator, moduleMetadata } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NEVER, of, throwError } from 'rxjs';
import {
  MapFeatureCharts,
  MapFeatureFilterInput,
} from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../../../shared/occurrences.service';
import { RequestTimeoutError } from '../../../../shared/request-timeout.service';
import { storyCharts } from '../../../../testing/storybook.fixtures';
import { VisibleMapChartsDialogComponent } from './visible-map-charts-dialog.component';

type ChartsState = 'loaded' | 'loading' | 'empty' | 'error' | 'timeout';

interface VisibleChartsStoryArgs {
  state: ChartsState;
  area: boolean;
  activeDetails: boolean;
}

const closeDialog = fn();

function filterForArgs(args: VisibleChartsStoryArgs): MapFeatureFilterInput {
  return {
    categories: ['Furto', 'Roubo', 'Estelionato', 'Veículos recuperados'],
    afterDate: '2026-01-01',
    beforeDate: '2026-08-31',
    periods: ['À noite'],
    startHour: 18,
    endHour: 23,
    ...(args.activeDetails
      ? {
          vehicleBrands: ['VW'],
          objectTypes: ['TELEFONE CELULAR'],
          phoneBrandModels: ['Samsung · Galaxy'],
          locationTypes: ['VIA PUBLICA'],
          weekdays: [1, 5],
        }
      : {}),
    ...(args.area
      ? {
          area: {
            longitude: -46.63331,
            latitude: -23.55052,
            radius: 750,
          },
        }
      : {
          bounds: {
            minLon: -46.69,
            minLat: -23.59,
            maxLon: -46.58,
            maxLat: -23.51,
          },
        }),
  };
}

function chartsResponse(state: ChartsState) {
  switch (state) {
    case 'loading':
      return NEVER;
    case 'empty': {
      const emptyCharts: MapFeatureCharts = {
        ...storyCharts,
        totalFeatures: 0,
        totalRecords: 0,
      };
      return of(emptyCharts);
    }
    case 'error':
      return throwError(() => new Error('Falha fictícia'));
    case 'timeout':
      return throwError(() => new RequestTimeoutError());
    default:
      return of(storyCharts);
  }
}

const meta = {
  title: 'Análises/Gráficos do mapa',
  component: VisibleMapChartsDialogComponent,
  decorators: [
    moduleMetadata({ imports: [VisibleMapChartsDialogComponent] }),
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--dialog">${story}</div>`
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    state: {
      control: 'select',
      options: ['loaded', 'loading', 'empty', 'error', 'timeout'],
    },
    area: { control: 'boolean' },
    activeDetails: { control: 'boolean' },
  },
  args: {
    state: 'loaded',
    area: false,
    activeDetails: false,
  },
  render: (args) => ({
    applicationConfig: {
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { filter: filterForArgs(args), zoom: 16 },
        },
        {
          provide: MatDialogRef,
          useValue: { close: closeDialog },
        },
        {
          provide: OccurrencesService,
          useValue: {
            getChartsForBounds: () => chartsResponse(args.state),
          },
        },
      ],
    },
    template: '<app-visible-map-charts-dialog />',
  }),
} satisfies Meta<VisibleChartsStoryArgs>;

export default meta;
type Story = StoryObj<VisibleChartsStoryArgs>;

export const Playground: Story = {};

export const RecorteVisivel: Story = {};

export const AreaSelecionada: Story = {
  args: {
    area: true,
  },
};

export const FiltrosAtivos: Story = {
  args: {
    activeDetails: true,
  },
};

export const AplicarDetalhe: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filterSections = canvas.getAllByText('Selecionar valores');
    await userEvent.click(filterSections[2]);
    const objectType = await canvas.findByRole('button', {
      name: 'Telefone celular (812)',
    });
    await userEvent.click(objectType);
    const apply = canvas.getByRole('button', { name: 'Aplicar ao mapa' });
    await expect(apply).toBeEnabled();
    await userEvent.click(apply);
  },
};

export const SemOcorrencias: Story = {
  args: {
    state: 'empty',
  },
};

export const Carregando: Story = {
  args: {
    state: 'loading',
  },
};

export const Erro: Story = {
  args: {
    state: 'error',
  },
};

export const TempoEsgotado: Story = {
  args: {
    state: 'timeout',
  },
};
