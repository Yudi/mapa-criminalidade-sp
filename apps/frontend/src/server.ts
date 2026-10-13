import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const appDistFolder = resolve(serverDistFolder, '..');
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  trustProxyHeaders: true,
  allowedHosts: ['criminalidade.yudi.com.br'],
});

// Crawlers request these at the domain root, outside the /app asset mount.
app.get(['/robots.txt', '/app/robots.txt'], (_req, res) => {
  res.sendFile(resolve(browserDistFolder, 'robots.txt'), { maxAge: '1h' });
});

app.get(['/sitemap.xml', '/app/sitemap.xml'], (_req, res) => {
  res.sendFile(resolve(browserDistFolder, 'sitemap.xml'), { maxAge: '1h' });
});

app.get('/app/3rdpartylicenses.txt', (_req, res) => {
  res.sendFile(resolve(appDistFolder, '3rdpartylicenses.txt'));
});

/**
 * Serve static files from /browser
 */
app.use(
  '/app',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/app') {
    res.redirect(308, `/app/${req.url.slice(req.path.length)}`);
    return;
  }

  // The application has one page. Unknown URLs must not become soft 404s.
  if (req.path !== '/app/') {
    res.status(404).type('text/plain').send('Página não encontrada.');
    return;
  }

  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next()
    )
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
