export type QueueBlockCode = 'dependency_pending' | 'awaiting_acceptance' | 'dependency_failed' | 'dependency_attention' | 'missing_dependency'|'budget';
export interface QueueBlock { taskId: string; code: QueueBlockCode; reason: string }
export interface QueueEntry { taskId: string; ready: boolean; blockers: QueueBlock[] }
export interface QueueReport { concurrency: number; active: number; availableSlots: number; ready: number; blocked: number; entries: QueueEntry[] }
