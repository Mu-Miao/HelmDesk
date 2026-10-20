import {sessionHeaders} from './session.js';
export async function tool<T = any>(name: string, args: object = {}, csrf: string): Promise<T> {
  const response = await fetch(`/api/tool/${name}`, { method: 'POST', credentials:'omit',redirect:'error', headers: { ...sessionHeaders(), 'Content-Type': 'application/json', 'X-HelmDesk-CSRF': csrf }, body: JSON.stringify(args) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? '请求失败'); return data;
}
export const states: Record<string, string> = { queued: '排队中', preparing: '准备中', running: '执行中', waiting_user: '等待处理', completed: '已完成', failed: '失败', cancelled: '已取消' };
export const acceptance: Record<string, string> = { pending: '等待验收', accepted: '验收通过', changes_requested: '需要返工' };
export const failures: Record<string, string> = { cleanup:'清理未确认',budget:'预算待处理',authentication: '登录失效', quota: '额度不足', permission: '权限确认', format: '输出变化', process: '执行异常', timeout: '任务超时', interrupted: '中断待核实' };
export const clock = (value?: string) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
export const number = (value?: number | null) => typeof value === 'number' ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value) : '不可用';
