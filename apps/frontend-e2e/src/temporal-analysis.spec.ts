import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

// Synthetic counts exercise the actual built app without querying PostGIS.
const category = {
  name: 'Furto',
  count: 12,
  rubricaForStyling: 'Furto',
  sourceType: 'rubrica',
};
const dateRange = {
  earliest: '2020-01-01',
  latest: '2024-03-12',
  defaultAfter: '2024-01-01',
};

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`compares periods and plays monthly frames at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    const temporalFilters: Record<string, unknown>[] = [];
    const tileDates: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (process.env['TEMPORAL_STATIC_BUILD']) {
      const root = resolve(process.env['TEMPORAL_STATIC_BUILD']);
      await page.route('http://temporal.test/**', async (route) => {
        const relative =
          new URL(route.request().url()).pathname.replace(/^\/app\/?/, '') ||
          'index.csr.html';
        const file = resolve(root, relative);
        if (!file.startsWith(root + '/')) return route.abort();
        const contentType =
          (
            {
              '.js': 'text/javascript',
              '.html': 'text/html',
              '.css': 'text/css',
              '.svg': 'image/svg+xml',
              '.woff2': 'font/woff2',
            } as Record<string, string>
          )[extname(file)] ?? 'application/octet-stream';
        await route.fulfill({ body: await readFile(file), contentType });
      });
    }
    await page.route('**/api/tiles/**', (route) => {
      const params = new URL(route.request().url()).searchParams;
      tileDates.push(`${params.get('after')}/${params.get('before')}`);
      return route.fulfill({ status: 200, body: '' });
    });
    await page.route('**/api/graphql', async (route) => {
      const { query, variables } = route.request().postDataJSON();
      let data: unknown;
      if (query.includes('query MapFeaturesDateRange'))
        data = { mapFeaturesDateRange: dateRange };
      else if (query.includes('query MapFeaturesMetadata'))
        data = {
          mapFeaturesMetadata: {
            dateRange,
            datasetRevision: 'synthetic-temporal-test',
            totalFeatures: 12,
            availableCategories: ['Furto'],
            availableRubricas: ['Furto'],
            availablePeriods: [],
            categoryStats: [category],
            periodStats: [],
            minZoom: 10,
            maxZoom: 19,
          },
        };
      else if (query.includes('query MapFeaturesCategoryPeriodStats'))
        data = {
          mapFeaturesCategoryPeriodStats: {
            categories: [category],
            periods: [],
          },
        };
      else if (query.includes('query TemporalStats')) {
        temporalFilters.push(variables.filter);
        const february = variables.filter.afterDate === '2024-02-01';
        data = {
          mapFeaturesTemporalStats: {
            datasetRevision: 'synthetic-temporal-test',
            total: february ? 6 : 12,
            monthly: [
              { label: '2024-01', count: 4 },
              { label: '2024-03', count: 8 },
            ],
            categories: february
              ? [{ label: 'Furto', count: 6 }]
              : [
                  { label: 'Furto', count: 8 },
                  { label: 'Roubo', count: 4 },
                ],
          },
        };
      } else throw new Error(`Unexpected query: ${query}`);
      await route.fulfill({ json: { data } });
    });
    await page.goto('/app/');
    await page
      .getByRole('button', { name: 'Selecionar todas', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Comparar períodos e ver evolução' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Análise temporal' })
    ).toBeVisible();
    await page.getByLabel('A · referência').fill('2024-02');
    await page.getByLabel('B', { exact: true }).fill('2024-03');
    await page.getByRole('button', { name: 'Comparar', exact: true }).click();
    await expect(
      page.getByText('Períodos parciais · datas alinhadas', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByLabel('Sem base percentual', { exact: true })
    ).toBeVisible();
    const comparison = temporalFilters.slice(-2);
    expect(comparison[0]['afterDate']).toBe('2024-02-01');
    expect(comparison[0]['beforeDate']).toBe('2024-02-12');
    expect(comparison[1]['afterDate']).toBe('2024-03-01');
    expect(comparison[1]['beforeDate']).toBe('2024-03-12');
    expect(comparison[0]['bounds']).toEqual(comparison[1]['bounds']);
    expect(comparison[0]['categories']).toEqual(comparison[1]['categories']);
    await page
      .getByRole('heading', { name: 'Análise temporal' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('comparison-light.png'),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Evolução', exact: true }).click();
    await page.getByRole('button', { name: 'Reproduzir', exact: true }).click();
    await expect
      .poll(() => tileDates.some((dates) => dates === '2024-01-01/2024-01-31'))
      .toBe(true);
    await expect
      .poll(
        () => tileDates.some((dates) => dates === '2024-02-01/2024-02-29'),
        { timeout: 20000 }
      )
      .toBe(true);
    const caption = page.locator('.temporal-map-caption');
    await expect(caption).toBeInViewport();
    await caption.getByRole('button', { name: 'Pausar', exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath('playback-light.png'),
      fullPage: true,
    });
    await page.getByLabel('Mês no mapa').click();
    await page
      .getByRole('option', { name: 'fev. de 2024', exact: true })
      .click();
    await expect(
      page.locator('app-temporal-analysis [role="status"]')
    ).toContainText('fev. de 2024');
    await page
      .locator('app-temporal-analysis')
      .getByRole('button', { name: 'Restaurar período', exact: true })
      .click();
    await expect.poll(() => tileDates.at(-1)).toBe('2024-01-01/2024-03-12');
    await expect(page.locator('.temporal-map-caption')).toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('app-chart-card').scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page
          .locator('app-temporal-analysis .mdc-tab__text-label')
          .evaluateAll((labels) => {
            const luminance = (color: string) => {
              const channels = (color.match(/[\d.]+/g) ?? [])
                .slice(0, 3)
                .map(Number)
                .map((value) => {
                  const channel = value / 255;
                  return channel <= 0.04045
                    ? channel / 12.92
                    : ((channel + 0.055) / 1.055) ** 2.4;
                });
              return (
                channels[0] * 0.2126 +
                channels[1] * 0.7152 +
                channels[2] * 0.0722
              );
            };
            const background = luminance(
              getComputedStyle(document.body).backgroundColor
            );
            return Math.min(
              ...labels.map((label) => {
                const foreground = luminance(getComputedStyle(label).color);
                return (
                  (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05)
                );
              })
            );
          })
      )
      .toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: testInfo.outputPath('trends-dark.png'),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Fechar análise', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Comparar períodos e ver evolução' })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
