import {
  ApplicationConfig,
  LOCALE_ID,
  inject,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';

import { ptBR } from 'date-fns/locale';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { MatIconRegistry } from '@angular/material/icon';
import { progressBarInterceptor } from './shared/progressbar.interceptor';
import { requestTimeoutInterceptor } from './shared/request-timeout.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(
      withFetch(),
      withInterceptors([requestTimeoutInterceptor, progressBarInterceptor])
    ),
    provideDateFnsAdapter(),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    { provide: MAT_DATE_LOCALE, useValue: ptBR },
    {
      provide: 'ICON_FONT_SETUP',
      useFactory: () => {
        const registry = inject(MatIconRegistry);
        registry.setDefaultFontSetClass('material-symbols-outlined');
        return true;
      },
    },
  ],
};
