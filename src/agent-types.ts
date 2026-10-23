export type AgentId='qoder-cn'|'ollama'|'antigravity';
export const agentName=(id?:string)=>id==='antigravity'?'Antigravity · 辅助':id==='ollama'?'Ollama 本地':'Qoder CN';
export interface AgentInfo {
  id:AgentId;label:string;available:boolean;version:string|null;
  modes:('probe'|'files')[];reason:string;source:string;
}
