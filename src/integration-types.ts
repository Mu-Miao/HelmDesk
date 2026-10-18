export interface FileStamp { sha256: string; bytes: number }
export interface IntegrationObservation {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  baseline: FileStamp | null;
  delivered: FileStamp | null;
  current: FileStamp | null;
  problem?: string;
}
export type IntegrationFileStatus = 'ready' | 'conflict' | 'already_applied' | 'blocked';
export interface IntegrationFile extends IntegrationObservation { status: IntegrationFileStatus; reason: string }
export interface IntegrationPlan {
  status: 'ready' | 'blocked' | 'nothing_to_apply';
  canExport: boolean;
  counts: { ready: number; conflict: number; alreadyApplied: number; blocked: number };
  files: IntegrationFile[];
}
export interface IntegrationPreview extends IntegrationPlan {
  schemaVersion: 1;
  taskId: string;
  checkedAt: string;
  fingerprint: string;
  limitations: string[];
}
export interface IntegrationPatch { filename: string; patch: string; sha256: string; preview: IntegrationPreview }
