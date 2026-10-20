import { useEffect, useState, useCallback } from 'react';
import type { Task } from '../../src/types';
import type { ModelPreference } from '../../src/model-types';
import type { CapabilityCatalog } from '../../src/capability-types';
import type { QueueReport } from '../../src/queue-types';
import type {ProjectSummary} from '../../src/project-types';
import {browserSession,sessionHeaders} from './session.js';
import {eventStream} from './event-stream.js';
export interface DeskState { tasks: Task[]; projects:ProjectSummary[]; queue:QueueReport; agent: any;agents:import('../../src/agent-types.js').AgentInfo[];executionPolicy:import('../../src/execution-types.js').ExecutionPolicyView; quota: any; capabilities: CapabilityCatalog; modelPreference: ModelPreference; cursor: number }
export function useDesk() {
  const [data, setData] = useState<DeskState | null>(null), [csrf, setCsrf] = useState(''), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/state',{credentials:'omit',redirect:'error',headers:sessionHeaders()}); if (!response.ok) throw new Error('本地服务连接失败');
    const state = await response.json(); setData(state); setError(''); return state as DeskState;
  }, []);
  useEffect(() => {
    let source: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined, disposed = false, attempts = 0, generation = 0;
    function reconnect() {
      if (disposed || retry) return;
      source?.abort(); setConnected(false); setError('与本地服务断开，正在自动重连…');
      retry = setTimeout(() => { retry = undefined; void connect(); }, Math.min(15000, 1000 * 2 ** attempts++));
    }
    async function connect() {
      const current = ++generation;
      source?.abort();
      try {
        const result = await browserSession(); if (disposed || current !== generation) return; setCsrf(result.csrf);
        const initial = await refresh(); if (disposed || current !== generation) return;
        source = new AbortController();
        await eventStream(initial.cursor,source.signal,()=>{if(disposed||current!==generation)return;setConnected(true);setError('');attempts=0;},()=>{
          if(disposed||current!==generation||timer)return;
          timer=setTimeout(()=>{timer=undefined;if(!disposed&&current===generation)void refresh().catch(reconnect);},120);
        });
      } catch (error) {
        if (disposed || current !== generation) return;
        if (error instanceof Error && error.message.includes('请从领航台')) { setConnected(false); setError(error.message); }
        else reconnect();
      }
    }
    const entryChanged = () => {
      if (!new URLSearchParams(window.location.hash.slice(1)).has('helmdesk-ticket')) return;
      if (retry) { clearTimeout(retry); retry = undefined; }
      void connect();
    };
    window.addEventListener('hashchange', entryChanged);
    void connect();
    return () => { disposed = true; window.removeEventListener('hashchange', entryChanged); source?.abort(); if (timer) clearTimeout(timer); if (retry) clearTimeout(retry); };
  }, [refresh]);
  return { data, csrf, connected, error, setError, refresh };
}
