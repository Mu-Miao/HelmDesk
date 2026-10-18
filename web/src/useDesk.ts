import { useEffect, useState, useCallback } from 'react';
import type { Task } from '../../src/types';
import type { ModelPreference } from '../../src/model-types';
import type { CapabilityCatalog } from '../../src/capability-types';
import type { QueueReport } from '../../src/queue-types';
import type {ProjectSummary} from '../../src/project-types';
export interface DeskState { tasks: Task[]; projects:ProjectSummary[]; queue:QueueReport; agent: any;agents:import('../../src/agent-types.js').AgentInfo[];executionPolicy:import('../../src/execution-types.js').ExecutionPolicyView; quota: any; capabilities: CapabilityCatalog; modelPreference: ModelPreference; cursor: number }
export function useDesk() {
  const [data, setData] = useState<DeskState | null>(null), [csrf, setCsrf] = useState(''), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/state'); if (!response.ok) throw new Error('本地服务连接失败');
    const state = await response.json(); setData(state); setError(''); return state as DeskState;
  }, []);
  useEffect(() => {
    let source: EventSource | undefined, timer: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined, disposed = false, attempts = 0;
    function reconnect() {
      if (disposed || retry) return;
      source?.close(); setConnected(false); setError('与本地服务断开，正在自动重连…');
      retry = setTimeout(() => { retry = undefined; void connect(); }, Math.min(15000, 1000 * 2 ** attempts++));
    }
    async function connect() {
      try {
        const session = await fetch('/api/session'); if (!session.ok) throw new Error('无法建立本机会话');
        const result = await session.json(); if (disposed) return; setCsrf(result.csrf);
        const initial = await refresh(); if (disposed) return;
        source = new EventSource(`/api/events?after=${initial.cursor}`);
        source.onopen = () => { setConnected(true); setError(''); attempts = 0; };
        source.onerror = reconnect;
        source.onmessage = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; void refresh().catch(reconnect); }, 120); };
      } catch { reconnect(); }
    }
    void connect();
    return () => { disposed = true; source?.close(); if (timer) clearTimeout(timer); if (retry) clearTimeout(retry); };
  }, [refresh]);
  return { data, csrf, connected, error, setError, refresh };
}
