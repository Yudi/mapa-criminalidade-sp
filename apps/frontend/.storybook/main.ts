import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../src/app/**/*.stories.@(js|ts)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/angular',
    options: {},
  },
  staticDirs: [
    '../public',
    {
      from: '../../../node_modules/@fontsource/material-symbols-outlined',
      to: '/storybook-assets/material-symbols-outlined',
    },
  ],
};

export default config;
