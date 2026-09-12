import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getErrorMessage } from '../../shared/error.utils';

const PROCESS_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_OUTPUT_LIMIT = 1_048_576;

export interface PythonProcessResult {
  stdout: string;
  stderr: string;
}

class BoundedOutput {
  private value = '';
  private truncated = false;

  constructor(private readonly limit: number) {}

  append(chunk: Buffer | string): void {
    if (this.truncated) return;
    const text = chunk.toString();
    const remaining = this.limit - this.value.length;
    if (text.length <= remaining) {
      this.value += text;
      return;
    }
    this.value += text.slice(0, Math.max(0, remaining));
    this.value += '\n[… output truncated …]';
    this.truncated = true;
  }

  toString(): string {
    return this.value;
  }
}

@Injectable()
export class PythonToolService implements OnModuleDestroy {
  private readonly activeChildren = new Set<ChildProcess>();
  private isShuttingDown = false;
  private readonly outputLimit = this.getPositiveIntegerEnv(
    'DATA_IMPORT_SUBPROCESS_OUTPUT_LIMIT_BYTES',
    DEFAULT_OUTPUT_LIMIT,
    1024,
    16 * 1024 * 1024
  );

  private get pythonBinaryPath(): string {
    return process.env.PYTHON_BINARY_PATH?.trim() || 'python3';
  }

  async runAssetScript(
    scriptName: string,
    args: string[],
    timeoutMs: number
  ): Promise<PythonProcessResult> {
    if (this.isShuttingDown) {
      throw new Error('Python tool is shutting down');
    }
    const scriptPath = await this.resolveAssetPath(scriptName);
    if (this.isShuttingDown) {
      throw new Error('Python tool is shutting down');
    }

    return await new Promise((resolve, reject) => {
      const child = spawn(this.pythonBinaryPath, [scriptPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      this.activeChildren.add(child);
      const stdout = new BoundedOutput(this.outputLimit);
      const stderr = new BoundedOutput(this.outputLimit);
      let settled = false;
      let timeoutRequested = false;
      let closeResolve: () => void = () => undefined;
      const closed = new Promise<void>((resolveClosed) => {
        closeResolve = resolveClosed;
      });

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        this.activeChildren.delete(child);
        if (error) {
          reject(error);
        } else {
          resolve({
            stdout: stdout.toString().trim(),
            stderr: stderr.toString().trim(),
          });
        }
      };

      const timeoutHandle = setTimeout(() => {
        timeoutRequested = true;
        void (async () => {
          const terminated = await this.terminateChild(child, closed);
          if (!terminated) {
            finish(
              new Error(
                `Python script ${scriptName} did not terminate after timeout`
              )
            );
            return;
          }
          finish(
            new Error(
              `Python script ${scriptName} timed out after ${timeoutMs}ms`
            )
          );
        })();
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => stdout.append(data));
      child.stderr?.on('data', (data: Buffer) => stderr.append(data));
      child.once('error', (error) => {
        closeResolve();
        if (timeoutRequested) return;
        finish(
          new Error(
            `Failed to start Python script ${scriptName}: ${getErrorMessage(
              error
            )}`
          )
        );
      });
      child.once('close', (code, signal) => {
        closeResolve();
        if (timeoutRequested) return;
        if (code === 0) {
          finish();
          return;
        }
        const suffix = signal ? ` (signal ${signal})` : '';
        finish(
          new Error(
            `Python script ${scriptName} exited with code ${
              code ?? 'unknown'
            }${suffix}: ${stderr.toString().trim()}`
          )
        );
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    await Promise.all(
      Array.from(this.activeChildren).map((child) =>
        this.terminateChild(child, undefined, true)
      )
    );
  }

  async resolveAssetPath(scriptName: string): Promise<string> {
    const candidates = [
      path.resolve(process.cwd(), 'assets', 'python', scriptName),
      path.resolve(
        process.cwd(),
        'apps',
        'backend',
        'src',
        'assets',
        'python',
        scriptName
      ),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new Error(
      `Python asset script not found: ${scriptName}. Checked ${candidates.join(
        ', '
      )}`
    );
  }

  private async terminateChild(
    child: ChildProcess,
    closedPromise?: Promise<void>,
    forceImmediately = false
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    const closed =
      closedPromise ??
      new Promise<void>((resolve) => child.once('close', resolve));
    this.signalProcessGroup(child, forceImmediately ? 'SIGKILL' : 'SIGTERM');

    if (
      await this.waitForClose(
        closed,
        forceImmediately ? 1_000 : PROCESS_TERMINATION_GRACE_MS
      )
    ) {
      return true;
    }

    this.signalProcessGroup(child, 'SIGKILL');
    return await this.waitForClose(closed, PROCESS_TERMINATION_GRACE_MS);
  }

  private signalProcessGroup(
    child: ChildProcess,
    signal: NodeJS.Signals
  ): void {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to the direct child when a process group is unavailable.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // The child may have exited between the state check and the signal.
    }
  }

  private async waitForClose(
    closed: Promise<void>,
    timeoutMs: number
  ): Promise<boolean> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([closed.then(() => true), timeout]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  }

  private getPositiveIntegerEnv(
    name: string,
    fallback: number,
    min: number,
    max: number
  ): number {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min) return fallback;
    return Math.min(value, max);
  }
}
