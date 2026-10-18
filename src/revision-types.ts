import type {Task,Submission} from './types.js';
export interface RevisionRequest {taskId:string;feedback:string;model?:string;reasoningEffort?:import('./reasoning.js').ReasoningEffort}
export interface RevisionLink {sourceTaskId:string;rootTaskId:string;feedback:string}
export interface RevisionDraft {sourceTaskId:string;sourceUpdatedAt:string;fingerprint:string;submission:Submission;notes:string[]}
export interface RevisionItem {id:string;title:string;state:Task['state'];acceptance:Task['acceptance'];verification:string|null;model:string;effort:string|null;sourceTaskId:string|null;createdAt:string}
export interface RevisionFamily {currentTaskId:string;rootTaskId:string;items:RevisionItem[];problem?:string}
