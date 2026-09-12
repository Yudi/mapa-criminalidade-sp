import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PythonToolService } from './python-tool.service';

describe('PythonToolService process boundary', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('bounds child output and waits for normal close', async () => {
    process.env.PYTHON_BINARY_PATH = process.execPath;
    process.env.DATA_IMPORT_SUBPROCESS_OUTPUT_LIMIT_BYTES = '1024';
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'python-tool-'));
    const scriptPath = path.join(directory, 'child.js');
    await fs.writeFile(scriptPath, "process.stdout.write('x'.repeat(4096));\n");
    const service = new PythonToolService();
    jest
      .spyOn(
        service as unknown as {
          resolveAssetPath: (name: string) => Promise<string>;
        },
        'resolveAssetPath'
      )
      .mockResolvedValue(scriptPath);

    const result = await service.runAssetScript('child.js', [], 5_000);

    expect(result.stdout).toContain('output truncated');
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('escalates a timed-out child after the grace period', async () => {
    process.env.PYTHON_BINARY_PATH = process.execPath;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'python-tool-'));
    const scriptPath = path.join(directory, 'child.js');
    await fs.writeFile(scriptPath, 'setTimeout(() => undefined, 30_000);\n');
    const service = new PythonToolService();
    jest
      .spyOn(
        service as unknown as {
          resolveAssetPath: (name: string) => Promise<string>;
        },
        'resolveAssetPath'
      )
      .mockResolvedValue(scriptPath);

    await expect(service.runAssetScript('child.js', [], 50)).rejects.toThrow(
      'timed out'
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
});
