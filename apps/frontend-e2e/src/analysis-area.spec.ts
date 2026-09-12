import { test, expect } from '@playwright/test';

// Synthetic data: exercise the UI and request scope without touching PostGIS.
const category = {
  name: 'Furto',
  count: 12,
  rubricaForStyling: 'Furto',
  sourceType: 'rubrica',
};
const dateRange = {
  earliest: '2026-01-01',
  latest: '2026-09-01',
  defaultAfter: '2026-08-01',
};

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`analyzes a polygon and address radius at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const filters: Record<string, unknown>[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/tiles/**', (route) =>
      route.fulfill({ status: 200, body: '' })
    );
    await page.route('**/api/geocoding/search**', (route) =>
      route.fulfill({ json: [{ lat: '-23.5503953', lon: '-46.63394714' }] })
    );
    await page.route('**/api/graphql', async (route) => {
      const { query, variables } = route.request().postDataJSON();
      let data: unknown;
      if (query.includes('query MapFeaturesDateRange'))
        data = { mapFeaturesDateRange: dateRange };
      else if (query.includes('query MapFeaturesMetadata'))
        data = {
          mapFeaturesMetadata: {
            dateRange,
            datasetRevision: 'synthetic-area-test',
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
      else if (query.includes('query MapFeaturesCategoryPeriodStats')) {
        filters.push(variables.filter);
        data = {
          mapFeaturesCategoryPeriodStats: {
            categories: [category],
            periods: [],
          },
        };
      } else if (query.includes('query MapFeaturesCharts')) {
        filters.push(variables.filter);
        data = {
          mapFeaturesCharts: {
            totalFeatures: 12,
            totalRecords: 16,
            categoryDistribution: [{ label: 'Furto', count: 12 }],
            periodDistribution: [],
            weekdayDistribution: [],
            weekdayHourDistribution: [],
            recordTypeDistribution: [],
            objectTypeDistribution: [],
            vehicleBrandDistribution: [],
            phoneBrandDistribution: [],
            locationTypeDistribution: [],
            policeCircumscriptionDistribution: [],
            policeUnitDistribution: [],
            weaponTypeDistribution: [],
            drugTypeDistribution: [],
          },
        };
      } else throw new Error(`Unexpected query: ${query}`);
      await route.fulfill({ json: { data } });
    });
    await page.goto('/app/');
    await page
      .getByRole('button', { name: 'Analisar área', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Desenhar polígono' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Desenhar polígono' }).click();
    const map = page.locator('#ol-map-tab');
    const box = await map.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }));
    for (const [x, y] of [
      [0.25, 0.18],
      [0.7, 0.18],
      [0.6, 0.42],
    ]) {
      await map.click({ position: { x: box.width * x, y: box.height * y } });
    }
    await page.getByRole('button', { name: 'Concluir área' }).click();
    await expect(
      page.getByText('Polígono selecionado', { exact: false })
    ).toBeVisible();
    await expect
      .poll(() => filters.some((filter) => !!filter['area']))
      .toBe(true);
    const selected = filters.find((filter) => !!filter['area']);
    expect(selected?.['bounds']).toBeUndefined();
    const beforePan = filters.length;
    await map.hover({ position: { x: box.width * 0.5, y: box.height * 0.25 } });
    await page.mouse.wheel(0, 300);
    // Wait for actual viewport movement, then ensure the selected scope persists.
    await expect(
      page.getByText('Polígono selecionado', { exact: false })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Selecionar todas', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Gráficos da área selecionada' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Gráficos da área selecionada' })
    ).toBeVisible();
    await expect(
      page.getByText('Ocorrências na área', { exact: true })
    ).toBeVisible();
    expect(filters.at(-1)?.['area']).toEqual(selected?.['area']);
    expect(filters.length).toBeLessThanOrEqual(beforePan + 1);
    await page.getByRole('button', { name: 'Fechar gráficos' }).click();
    await page.getByRole('button', { name: 'Voltar à área visível' }).click();
    await expect(
      page.getByRole('button', { name: 'Gráficos do mapa', exact: true })
    ).toBeVisible();
    await page.getByLabel('Nome da via e número').fill('Praça da Sé');
    await page.getByLabel('Cidade', { exact: true }).fill('São Paulo');
    await page.getByRole('button', { name: 'Buscar endereço' }).click();
    await page
      .getByRole('button', { name: 'Analisar área', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Usar raio do endereço' })
    ).toBeEnabled();
    await page.getByLabel('Raio (metros)').fill('1000');
    await page.getByRole('button', { name: 'Usar raio do endereço' }).click();
    await expect(
      page.getByText('Raio de 1000 m selecionado', { exact: false })
    ).toBeVisible();
    await expect
      .poll(() => (filters.at(-1)?.['area'] as { radius?: number })?.radius)
      .toBe(1000);
    expect(filters.at(-1)?.['bounds']).toBeUndefined();
    await expect(
      page.getByRole('button', { name: 'Desenhar polígono' })
    ).toBeHidden();
    const controls = await page
      .getByRole('region', { name: 'Área de análise', exact: true })
      .boundingBox();
    expect(controls?.height).toBeLessThan(80);
    await page
      .getByRole('button', { name: 'Editar área', exact: true })
      .click();
    await expect(page.getByLabel('Raio (metros)')).toHaveValue('1000');
    await page
      .getByRole('button', { name: 'Ocultar controles da área' })
      .click();
    await map.scrollIntoViewIfNeeded();
    await page.locator('.card-section').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath('area-light.png'),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: testInfo.outputPath('area-dark.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
