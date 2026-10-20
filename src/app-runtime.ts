import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';

export const appProtocolVersion = 1;

/** No credentials belong in the HTTP identity response. */
export function appIdentity(directory: string, port: number) {
  return {
    service: 'helmdesk' as const,
    protocolVersion: appProtocolVersion,
    instanceId: randomUUID(),
    dataDirectory: realpathSync(directory),
    port,
    version: '0.1.0',
  };
}

export type AppIdentity = ReturnType<typeof appIdentity>;
