import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { submissionSchema, idSchema, modelPreferenceSchema, integrationSelectionSchema, integrationExportSchema, revisionRequestSchema, revisionSubmitSchema,agentIdSchema,executionPolicySchema } from './schema.js';
import {briefSchema,briefListSchema,watchSchema} from './review.js';
import { errorText } from './redact.js';

export async function startMcp(directory: string,autostart=false,concurrency=1) {
  const server = new McpServer({ name: 'helmdesk', version: '0.1.0' });
  async function call(name: string, args: unknown) {
    try {
      if(autostart){const{ensureLocalService}=await import('./local-service.js');await ensureLocalService(directory,concurrency);}
      const connection = JSON.parse(readFileSync(join(directory, 'connection.json'), 'utf8')) as { port: number; token: string };
      if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) throw new Error('连接文件端口无效');
      const response = await fetch(`http://127.0.0.1:${connection.port}/api/tool/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(62_000) });
      const result = await response.json();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: !response.ok };
    } catch (error) { return { content: [{ type: 'text' as const, text: errorText(error) }], isError: true }; }
  }
  const id = { taskId: idSchema };
  const tools = [
    ['agents_list', '探测 Qoder CN CLI 版本、兼容路径和能力；不会发起模型请求', z.object({})],
    ['models_list', '按明确执行器读取当前模型目录；Ollama 仅列出已有本地模型，不自动下载或切换执行器', z.object({agent:agentIdSchema.optional()}).strict()],
    ['model_preference_get', '读取主要或指定执行器的默认模型；不影响 CLI 桌面聊天', z.object({agent:agentIdSchema.optional()}).strict()],
    ['model_preference_set', '保存后续新任务的默认模型和思考深度，使用 CLI 目录校验；不会改变排队或执行中任务', modelPreferenceSchema],
    ['execution_policy_get','读取最大轮数默认值及按执行器/模型分开的累计 Credits 派发阈值；不表示账号余额',z.object({}).strict()],
    ['execution_policy_set','明确保存后续新任务的最大轮数默认值及派发阈值；影响未发起请求的任务，不中断在途请求；未知用量阻止新派发，不是 Credits 硬上限',executionPolicySchema],
    ['task_submit', '在独立副本或干净 Git worktree 中创建受限任务。可明确选择已验证且已验收的交付作为只读输入；Codex 负责审查和整合', submissionSchema],
    ['task_brief_get','读取有界交付摘要和版本；不包含提示词、差异或完整日志，不能替代独立验证',briefSchema],
    ['task_briefs_list','分页读取紧凑任务摘要，可筛项目或待审核/返工/等待处理；游标过期须重新读取，不自动派活',briefListSchema],
    ['tasks_watch','批量等待最多 8 项任务，仅返回版本变化的紧凑摘要；携带已知 version 避免重复结果，最多 55 秒，无模型请求',watchSchema],
    ['task_list', '列出任务和独立验收状态', z.object({})],
    ['project_summary_get','按原项目与请求模型分别汇总领航台已记录任务；缺失用量保留未知，不表示账号余额',z.object({projectPath:z.string().min(1).max(2000).optional()}).strict()],
    ['task_revision_history','读取任务完整修订家族，执行/验证/验收分别展示，不执行任务',z.object(id)],
    ['task_revision_prepare','准备显式修订预览，固定原文件范围与项目、继承模型深度，清空共享能力，不复制未验收工作文件，不执行模型',revisionRequestSchema],
    ['task_revision_submit','按有效预览创建新的隔离修订任务，会产生新的模型请求；requestId 幂等，重复相同请求只返回同一任务，不自动重试',revisionSubmitSchema],
    ['queue_get', '读取隔离执行槽位、排队任务与依赖等待原因；不自动重试或切换模型', z.object({})],
    ['task_get', '读取任务、差异、结果摘要与用量；完成不代表验收通过', z.object(id)],
    ['task_export', '导出已结束任务的审核报告和已存差异；不读取完整工作文件，不写入或合并原项目', z.object(id)],
    ['task_integration_check', '只读检查已验证且已验收交付的明确文件选择，比较原项目基线/当前内容与隔离输出；返回冲突和预览凭据，不写入原项目', integrationSelectionSchema],
    ['task_patch_export', '按预览凭据重新核对所选文件，再导出 UTF-8 文本补丁；旧预览、有冲突或交付变化会拒绝，不应用补丁', integrationExportSchema],
    ['task_events', '按全局单调游标读取任务事件；返回 cursor 供下次增量查询', z.object({ ...id, after: z.number().int().min(0).default(0) })],
    ['task_wait', '有界等待终态或需要用户处理，最多 55 秒；不自动重试任务', z.object({ ...id, after: z.number().int().min(0).default(0), timeoutMs: z.number().int().min(0).max(55000).default(30000) })],
    ['task_cancel', '取消排队任务，或终止领航台当前拥有的执行进程树；不删除工作副本', z.object(id)],
    ['task_verify', 'Codex 记录交付验证结果、命令和证据；与执行状态、人工验收分别保存。失败会标记需要返工', z.object({ ...id, status: z.enum(['passed', 'failed', 'not_run']), command: z.string().max(2000).default(''), evidence: z.string().min(1).max(8000) })],
    ['task_review', 'Codex 审查结果后记录验收；不会自动合并。验收通过后依赖任务才会运行', z.object({ ...id, acceptance: z.enum(['accepted', 'changes_requested']), note: z.string().min(1).max(4000) })],
    ['usage_get', '分开返回任务消耗、会话累计和最近账号额度快照；缺失显示不可用，累计值不重复相加', z.object({ taskId: idSchema.optional() })],
    ['capabilities_list', '查看明确选择的 Skills 与本地只读 MCP 目录、来源摘要、兼容性和排除原因；不会自动扫描 Codex 配置', z.object({})],
    ['capabilities_refresh', '重新检查启动时批准的共享来源，生成目录与兼容状态；本地 MCP 在受限沙箱内探测，不发起模型请求', z.object({})]
  ] as const;
  for (const [name, description, schema] of tools) server.registerTool(name, { description, inputSchema: schema }, (args: unknown) => call(name, args));
  await server.connect(new StdioServerTransport());
}
