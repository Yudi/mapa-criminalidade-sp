import type { Preview } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import {
  inject,
  LOCALE_ID,
  provideEnvironmentInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { MatIconRegistry } from '@angular/material/icon';
import { ptBR } from 'date-fns/locale';

registerLocaleData(localePt);

class StorybookResizeObserver implements ResizeObserver {
  disconnect(): void {
    return;
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    void target;
    void options;
  }

  unobserve(target: Element): void {
    void target;
  }
}

globalThis.ResizeObserver ??= StorybookResizeObserver;

const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withFetch()),
        provideDateFnsAdapter(),
        provideEnvironmentInitializer(() => {
          inject(MatIconRegistry).setDefaultFontSetClass(
            'material-symbols-outlined'
          );
        }),
        { provide: LOCALE_ID, useValue: 'pt-BR' },
        { provide: MAT_DATE_LOCALE, useValue: ptBR },
      ],
    }),
    (story, context) => {
      const theme = context.globals['theme'] as 'light' | 'dark' | 'system';
      document.documentElement.style.colorScheme =
        theme === 'system' ? 'light dark' : theme;
      document.body.style.colorScheme =
        theme === 'system' ? 'light dark' : theme;
      return story();
    },
  ],
  globalTypes: {
    theme: {
      description: 'Tema visual',
      defaultValue: 'system',
      toolbar: {
        icon: 'contrast',
        items: [
          { value: 'system', title: 'Sistema' },
          { value: 'light', title: 'Claro' },
          { value: 'dark', title: 'Escuro' },
        ],
      },
    },
  },
  parameters: {
    a11y: {
      test: 'todo',
    },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default preview;
