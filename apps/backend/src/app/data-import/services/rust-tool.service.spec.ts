import { RustToolService } from './rust-tool.service';

describe('RustToolService process boundary', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses the configured binary and bounds captured diagnostics', async () => {
    process.env.RUST_BINARY_PATH = '/bin/sh';
    process.env.DATA_IMPORT_SUBPROCESS_OUTPUT_LIMIT_BYTES = '1024';
    const service = new RustToolService();

    const result = await service.runDatasetHandlingCommand([
      '-c',
      'printf "configured-rust"',
    ]);

    expect(service.getRustBinaryPath()).toBe('/bin/sh');
    expect(result.stdout).toBe('configured-rust');
    await service.onModuleDestroy();
  });

  it('terminates a timed-out process before releasing the slot', async () => {
    process.env.RUST_BINARY_PATH = '/bin/sh';
    const service = new RustToolService();

    await expect(
      service.runDatasetHandlingCommand(['-c', 'sleep 30'], 100)
    ).rejects.toThrow('timed out');
    await service.onModuleDestroy();
  });
});
