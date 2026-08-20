import { execFileSync } from 'node:child_process';

import type { BinaryResolution, CommandRunnerResult, DoctorCommandRunner } from './types';

function trimOrNull(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeWhich(command: string): string | null {
  try {
    return trimOrNull(execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

export function resolveBinaryFromPath(command: string): BinaryResolution {
  const resolvedPath = safeWhich(command);
  if (resolvedPath) {
    return {
      command,
      path: resolvedPath,
      resolution_status: 'resolved',
      source_hint: 'PATH',
      detail: `${command} resolved from PATH at ${resolvedPath}.`,
    };
  }

  return {
    command,
    path: null,
    resolution_status: 'not_found',
    source_hint: 'PATH lookup returned no matching binary',
    detail: `${command} was not resolved from PATH.`,
  };
}

export function parseSfVersion(raw: string | null): { raw: string | null; parsed_version: string | null; status: 'available' | 'unavailable' | 'parse_failed' | 'command_failed' } {
  if (!raw) {
    return {
      raw: null,
      parsed_version: null,
      status: 'unavailable',
    };
  }

  const versionMatch = raw.match(/@salesforce\/cli\/(\d+\.\d+\.\d+)/) ?? raw.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!versionMatch) {
    return {
      raw,
      parsed_version: null,
      status: 'parse_failed',
    };
  }

  return {
    raw,
    parsed_version: versionMatch[1],
    status: 'available',
  };
}

export class SystemDoctorCommandRunner implements DoctorCommandRunner {
  resolveBinary(command: string): BinaryResolution {
    return resolveBinaryFromPath(command);
  }

  run(command: string, args: string[]): CommandRunnerResult {
    try {
      const stdout = execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return {
        stdout,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        stdout: typeof error === 'object' && error !== null && 'stdout' in error ? String(error.stdout ?? '') : '',
        stderr: typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr ?? '') : '',
        exitCode: typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 1,
      };
    }
  }
}
