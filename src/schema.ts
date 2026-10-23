import { z } from 'zod';
import { flashEfforts } from './reasoning.js';
export const reasoningEffortSchema = z.enum(flashEfforts).optional().describe('Flash 支持 low、medium、xhigh；省略时继承领航台默认设置。每次请求按官方目录校验，不降档');
export const agentIdSchema=z.enum(['qoder-cn','ollama','antigravity']);
export const modelPreferenceSchema = z.object({agent:agentIdSchema.optional(),model:z.string().trim().min(1).max(150),reasoningEffort:reasoningEffortSchema,makePrimary:z.boolean().optional().describe('false 只保存该执行器的默认模型，不改变主要执行器；辅助 Antigravity 默认 false')}).strict();
export const submissionSchema = z.object({
  agent:agentIdSchema.optional(),
  maxTurns:z.number().int().min(1).max(100).optional().describe('明确请求最大执行轮数；Qoder 通过官方 SDK 传入，Ollama 无工具任务只允许 1 轮'),
  probePurpose:z.literal('model-compatibility').optional().describe('明确标记无工具的模型兼容性探测；不授予额外权限'),
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(40_000),
  projectPath: z.string().min(1).max(2000),
  allowedFiles: z.array(z.string().min(1).max(500)).max(100).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1).max(30),
  dependencies: z.array(z.string().uuid()).max(20).default([]),
  inputs: z.array(z.object({taskId:z.string().uuid(),paths:z.array(z.string().min(1).max(500)).min(1).max(10)}).strict()).max(4).default([]).describe('明确选择已验证且已验收任务的交付文件；固定摘要后作为 .helmdesk-inputs/<任务编号>/<路径> 只读输入，不合并原项目'),
  model: z.string().trim().min(1).max(150).optional().describe('显式指定 CLI 模型名或已有自定义 modelID；省略时使用领航台保存的默认模型'),
  reasoningEffort:reasoningEffortSchema,
  capabilities: z.object({skills:z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)).max(20).default([]),tools:z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}\/[A-Za-z0-9_-]{1,80}$/)).max(20).default([])}).strict().optional().describe('从 capabilities_list 选择技能与只读 MCP；省略时继承已批准的共享默认值，显式空数组关闭共享；probe 始终无工具'),
  mode: z.enum(['probe', 'shared', 'files']).optional().describe('shared 仅使用技能快照与只读 MCP，不开放原生文件工具；省略时 Antigravity 用 shared，其他执行器用 files'),
  timeoutSeconds: z.number().int().min(10).max(600).default(120)
}).strict().superRefine((value,ctx)=>{if(value.probePurpose&&value.mode!=='probe')ctx.addIssue({code:'custom',message:'模型兼容性探测必须禁用工具'});});
export const idSchema = z.string().uuid();
export const integrationSelectionSchema = z.object({taskId:idSchema,paths:z.array(z.string().min(1).max(500)).max(20).optional()}).strict();
export const integrationExportSchema = integrationSelectionSchema.extend({fingerprint:z.string().regex(/^[a-f0-9]{64}$/)});
export const revisionRequestSchema=z.object({taskId:idSchema,feedback:z.string().trim().min(1).max(4000),model:z.string().trim().min(1).max(150).optional(),reasoningEffort:reasoningEffortSchema}).strict();
export const revisionSubmitSchema=revisionRequestSchema.extend({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),requestId:idSchema});
export const executionPolicySchema=z.object({maxTurns:z.number().int().min(1).max(100).optional(),budgets:z.array(z.object({agent:agentIdSchema,model:z.string().trim().min(1).max(150),maxCredits:z.number().positive().finite()}).strict()).max(20).default([])}).strict().superRefine((value,ctx)=>{
  const keys=value.budgets.map(r=>JSON.stringify([r.agent,r.model]));if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'同一执行器和模型的预算重复'});
  if(value.budgets.some(r=>r.agent!=='qoder-cn'))ctx.addIssue({code:'custom',message:'只有提供任务 Credits 的 Qoder 可设置 Credits 阈值'});
});
