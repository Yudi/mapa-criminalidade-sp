import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getErrorMessage } from '../../shared/error.utils';

interface PythonProcessResult {
  stdout: string;
  stderr: string;
}

@Injectable()
export class PythonToolService {
  private get pythonBinaryPath(): string {
    return process.env.PYTHON_BINARY_PATH ?? 'python3';
  }

  async runAssetScript(
    scriptName: string,
    args: string[],
    timeoutMs: number
  ): Promise<PythonProcessResult> {
    const scriptPath = await this.resolveAssetScript(scriptName);

    return await new Promise((resolve, reject) => {
      const child = spawn(this.pythonBinaryPath, [scriptPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        reject(
          new Error(
            `Python script ${scriptName} timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        if (!timedOut) {
          reject(
            new Error(
              `Failed to start Python script ${scriptName}: ${getErrorMessage(
                error
              )}`
            )
          );
        }
      });
      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `Python script ${scriptName} exited with code ${code}: ${stderr.trim()}`
            )
          );
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  private async resolveAssetScript(scriptName: string): Promise<string> {
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
}
