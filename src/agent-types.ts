export type AgentId='qoder-cn'|'ollama'|'antigravity'|'zcode';
export const agentName=(id?:string)=>id==='zcode'?'ZCode · 辅助':id==='antigravity'?'Antigravity · 辅助':id==='ollama'?'Ollama 本地':'Qoder CN';
export interface AgentInfo {
  id:AgentId;label:string;available:boolean;version:string|null;
  modes:('probe'|'shared'|'files')[];reason:string;source:string;
}
