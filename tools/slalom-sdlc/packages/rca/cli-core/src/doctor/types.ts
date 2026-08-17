import type { Status } from '../contracts/status';

export type DoctorMode = 'local-file' | 'fixture' | 'offline' | 'live-org';

export interface DoctorCheck {
  name: string;
  status: Status;
  code: string;
  summary: string;
  blocking: boolean;
  detail?: string;
  guidance?: string;
}

export interface DoctorResult {
  mode: DoctorMode;
  checks: DoctorCheck[];
  recommended_fix_path: string[];
  details?: Record<string, unknown>;
}
