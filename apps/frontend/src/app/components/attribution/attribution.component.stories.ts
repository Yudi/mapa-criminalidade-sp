import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import type { Meta, StoryObj } from '@storybook/angular';
import { componentWrapperDecorator } from '@storybook/angular';
import { NEVER, of, throwError } from 'rxjs';
import { AttributionComponent } from './attribution.component';

type LicenseState = 'loaded' | 'loading' | 'error';

interface AttributionStoryArgs {
  licenseState: LicenseState;
}

function licenseResponse(state: LicenseState) {
  switch (state) {
    case 'loading':
      return NEVER;
    case 'error':
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            statusText: 'Falha fictícia',
          })
      );
    default:
      return of(
        'OpenLayers 10.10.0\nCopyright OpenLayers contributors\nLicença BSD-2-Clause'
      );
  }
}

const meta = {
  title: 'Informações/Atribuições e licenças',
  component: AttributionComponent,
  decorators: [
    componentWrapperDecorator(
      (story) => `<div class="story-shell story-shell--dialog">${story}</div>`
    ),
  ],
  argTypes: {
    licenseState: {
      control: 'select',
      options: ['loaded', 'loading', 'error'],
    },
  },
  args: {
    licenseState: 'loaded',
  },
  render: (args) => ({
    applicationConfig: {
      providers: [
        {
          provide: HttpClient,
          useValue: {
            get: () => licenseResponse(args.licenseState),
          },
        },
      ],
    },
  }),
} satisfies Meta<AttributionStoryArgs>;

export default meta;
type Story = StoryObj<AttributionStoryArgs>;

export const Playground: Story = {};

export const LicencasCarregadas: Story = {};

export const CarregandoLicencas: Story = {
  args: {
    licenseState: 'loading',
  },
};

export const ErroNasLicencas: Story = {
  args: {
    licenseState: 'error',
  },
};
