const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

class BackendTypeScriptLoaderPlugin {
  apply(compiler) {
    const tsLoaderRule = compiler.options.module?.rules?.find((rule) =>
      String(rule?.loader ?? '').includes('ts-loader')
    );

    if (!tsLoaderRule?.options) {
      return;
    }

    tsLoaderRule.options.transpileOnly = false;
  }
}

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/backend'),
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        {
          input: './src/assets',
          glob: '**/*',
          output: 'assets',
          ignore: ['**/__pycache__/**', '**/test_*.py'],
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      typeCheckOptions: false,
      sourceMaps: true,
    }),
    new BackendTypeScriptLoaderPlugin(),
  ],
};
