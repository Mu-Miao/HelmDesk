export interface CapabilitySelection { skills: string[]; tools: string[] }
export interface SourceDigest { id: string; source: string; version: string; sha256: string; fileCount: number; bytes: number }
export interface SkillSnapshot extends SourceDigest { files: string[] }
export interface SharedTool { id: string; serverId: string; name: string; description: string; inputSchema: Record<string, unknown>; sourceSha256: string }
export interface CapabilityRun {
  skills: SkillSnapshot[];
  tools: SharedTool[];
  sourceChecks: { id: string; before: string; after?: string; unchanged?: boolean; error?: string }[];
  isolation?: { verified: boolean; checks: string[]; protectedRoots: string[] };
  configDirectory?: string;
  authentication?: {mode:'read-only-existing-login';verified:boolean};
}
export interface CapabilityCatalog {
  enabled: boolean; direction: string; reason: string; sampledAt: string;
  skills: (SourceDigest & { status: 'compatible'|'needs_adaptation'|'blocked'; reasons: string[] })[];
  servers: { id: string; source: string; status: 'ready'|'unavailable'; reason?: string; tools: SharedTool[] }[];
  exclusions: string[];
}
export interface WorkerGateway { url: string; token: string; skills: SkillSnapshot[]; tools: SharedTool[] }
