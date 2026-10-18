export type AgentId='qoder-cn'|'ollama';
export interface AgentInfo {
  id:AgentId;label:string;available:boolean;version:string|null;
  modes:('probe'|'files')[];reason:string;source:string;
}
