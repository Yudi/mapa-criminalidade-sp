import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator, moduleMetadata } from '@storybook/angular';
import { expect, fn, within } from 'storybook/test';
import { NEVER, of, throwError } from 'rxjs';
import { MapFeatureResponse } from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../../../shared/occurrences.service';
import { storyFeature } from '../../../../testing/storybook.fixtures';
import { FeatureDetailDialogComponent } from './feature-detail-dialog.component';

type DetailState = 'loaded' | 'loading' | 'not-found' | 'error';

interface FeatureDetailStoryArgs {
  state: DetailState;
  sparse: boolean;
  imlUnavailable: boolean;
  descriptiveTime: boolean;
}

const closeDialog = fn();

function featureForArgs(args: FeatureDetailStoryArgs): MapFeatureResponse {
  const feature: MapFeatureResponse = {
    ...storyFeature,
    imlUnavailable: args.imlUnavailable,
    featureData: {
      ...storyFeature.featureData,
      location: args.sparse ? {} : { ...storyFeature.featureData.location },
      occurrence: args.sparse
        ? {}
        : {
            ...storyFeature.featureData.occurrence,
            hora_ocorrencia: args.descriptiveTime
              ? 'DE MADRUGADA'
              : storyFeature.featureData.occurrence.hora_ocorrencia,
          },
      all_rubricas: args.sparse
        ? []
        : [...storyFeature.featureData.all_rubricas],
      records: args.sparse ? [] : [...storyFeature.featureData.records],
      summary: args.sparse
        ? {
            total_records: 0,
            celulares_count: 0,
            veiculos_count: 0,
            objetos_count: 0,
            dados_criminais_count: 0,
            produtividade_count: 0,
          }
        : { ...storyFeature.featureData.summary },
    },
    imlRecords: args.sparse ? [] : [...storyFeature.imlRecords],
  };

  return feature;
}

function detailResponse(args: FeatureDetailStoryArgs) {
  switch (args.state) {
    case 'loading':
      return NEVER;
    case 'not-found':
      return of(null);
    case 'error':
      return throwError(() => new Error('Falha fictícia'));
    default:
      return of(featureForArgs(args));
  }
}

const meta = {
  title: 'Mapa/Detalhes da ocorrência',
  component: FeatureDetailDialogComponent,
  decorators: [
    moduleMetadata({ imports: [FeatureDetailDialogComponent] }),
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
      options: ['loaded', 'loading', 'not-found', 'error'],
    },
    sparse: { control: 'boolean' },
    imlUnavailable: { control: 'boolean' },
    descriptiveTime: { control: 'boolean' },
  },
  args: {
    state: 'loaded',
    sparse: false,
    imlUnavailable: false,
    descriptiveTime: false,
  },
  render: (args) => ({
    applicationConfig: {
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            featureId: storyFeature.id,
            numBo: storyFeature.numBo,
            anoBo: storyFeature.anoBo,
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: closeDialog },
        },
        {
          provide: OccurrencesService,
          useValue: {
            getFullFeature: () => detailResponse(args),
          },
        },
      ],
    },
    template: '<app-feature-detail-dialog />',
  }),
} satisfies Meta<FeatureDetailStoryArgs>;

export default meta;
type Story = StoryObj<FeatureDetailStoryArgs>;

export const Playground: Story = {};

export const TodosOsTiposDeRegistro: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const heading of [
      /Registro de Óbitos - IML/,
      /Veículos \(1\)/,
      /Celulares \(1\)/,
      /Objetos \(1\)/,
      /Armas \(1\)/,
      /Entorpecentes \(1\)/,
      /Veículos recuperados \(1\)/,
      /Pessoas \(1\)/,
    ]) {
      await expect(canvas.getByText(heading)).toBeInTheDocument();
    }
  },
};

export const DadosMinimos: Story = {
  args: {
    sparse: true,
  },
};

export const ImlIndisponivel: Story = {
  args: {
    imlUnavailable: true,
  },
};

export const PeriodoDescritivo: Story = {
  args: {
    descriptiveTime: true,
  },
};

export const Carregando: Story = {
  args: {
    state: 'loading',
  },
};

export const NaoEncontrada: Story = {
  args: {
    state: 'not-found',
  },
};

export const Erro: Story = {
  args: {
    state: 'error',
  },
};
