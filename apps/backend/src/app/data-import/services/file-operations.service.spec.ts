import * as crypto from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { IncomingMessage, ServerResponse } from 'http';
import { FileOperationsService } from './file-operations.service';

type TestServerHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void;

describe('FileOperationsService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function withHttpServer<T>(
    handler: TestServerHandler,
    run: (baseUrl: string) => Promise<T>
  ): Promise<T> {
    const server = http.createServer(handler);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;

    try {
      return await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  function createLocalDownloadService(): FileOperationsService {
    process.env.DATA_IMPORT_ALLOWED_DOWNLOAD_HOSTS = '127.0.0.1';
    process.env.DATA_IMPORT_ALLOWED_DOWNLOAD_PROTOCOLS = 'http:,https:';
    process.env.DATA_IMPORT_DOWNLOAD_ATTEMPT_TIMEOUT_MS = '30000';

    return new FileOperationsService();
  }

  it('rejects downloads from hosts outside the allowlist', async () => {
    const service = new FileOperationsService();

    await expect(
      service.downloadAndHash('https://example.com/file.xlsx')
    ).rejects.toThrow('Download host is not allowed: example.com');
  });

  it('follows relative redirects on allowed hosts', async () => {
    await withHttpServer(
      (request, response) => {
        if (request.url === '/source.xlsx') {
          response.writeHead(302, { location: '/final.xlsx' });
          response.end();
          return;
        }

        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end('valid-content');
      },
      async (baseUrl) => {
        const service = createLocalDownloadService();
        const result = await service.downloadAndHash(`${baseUrl}/source.xlsx`);

        expect(result).toEqual({
          hash: crypto
            .createHash('sha256')
            .update('valid-content')
            .digest('hex'),
          size: 13,
        });
      }
    );
  });

  it('rejects redirects to hosts outside the allowlist', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(302, {
          location: 'https://example.com/final.xlsx',
        });
        response.end();
      },
      async (baseUrl) => {
        const service = createLocalDownloadService();

        await expect(
          service.downloadAndHash(`${baseUrl}/source.xlsx`)
        ).rejects.toThrow('Download host is not allowed: example.com');
      }
    );
  });

  it('rejects responses that exceed the configured byte limit', async () => {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end('too large');
      },
      async (baseUrl) => {
        process.env.DATA_IMPORT_MAX_DOWNLOAD_BYTES = '4';
        const service = createLocalDownloadService();

        await expect(
          service.downloadAndHash(`${baseUrl}/source.xlsx`)
        ).rejects.toThrow('Download exceeds 4 byte limit');
      }
    );
  });
});
