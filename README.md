# 领航台 · HelmDesk

在 Codex 里指挥，在领航台里看见。

本机 CLI Agent 调度工作台：通过已登录的 Qoder CN 官方 CLI 执行任务，用 SQLite 保存过程，通过 stdio MCP 接入宿主，并提供中文 React 看板。执行完成、独立验证和审核接受分别记录；宿主审阅后明确整合交付。

## 环境与启动

- macOS、Node.js 24+。
- 已登录的 Qoder CN 官方 CLI 或 Qoder CN App；HelmDesk 不要求额外提供模型 API Key。
- 隔离使用 macOS `sandbox-exec`，执行前检查失败会拒绝派发。

```sh
npm ci
npm run check
npm test
npm run dev
```

打开 <http://127.0.0.1:4317/>。`dev` 构建后启动服务，修改源码后需重新构建并重启；开发数据写入忽略的 `.helmdesk/`。`.npmrc` 禁止依赖安装脚本，并跳过未使用的可选 peer 工具链；执行器使用本机已有 CLI。

也可分开构建和启动：

```sh
npm run build
node dist/cli.js serve --data-dir .helmdesk --concurrency 2
```

默认并发为 1，只接受 1 或 2。直接 `npm start` 的默认数据目录为 `~/Library/Application Support/HelmDesk/`；可用 `--data-dir` 或 `HELMDESK_DATA_DIR` 修改。服务与 MCP 必须使用同一数据目录。

`node dist/cli.js doctor --data-dir .helmdesk` 检查版本、模型目录和隔离，不发起模型推理。`probe` 会调用真实模型并消耗账号额度，不要在同数据目录服务运行时另行执行。

## 接入 MCP

构建后按 [MCP 配置示例](docs/codex-mcp.toml.example) 添加服务，把路径改为本机绝对路径：

```toml
[mcp_servers.helmdesk]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/HelmDesk/dist/cli.js", "mcp", "--data-dir", "/absolute/path/to/HelmDesk/.helmdesk", "--autostart-service", "--concurrency", "2"]
```

可选宿主脚本 `node scripts/register-codex-mcp.mjs` 先检查，显式加 `--apply` 才通过本机 Codex 官方 CLI 注册；修改前在私有数据目录备份配置。脚本当前适用于默认安装位置的 macOS 桌面应用。普通服务和任务执行者不会修改宿主配置、技能、插件或记忆。

`--autostart-service` 在首次工具调用时启动缺失的后台服务；已有服务保持原配置。它不意味着开机启动或无人值守派活。更新工具后，旧 MCP 客户端需重连以刷新目录。

共 28 项工具：

| 用途 | 工具 |
| --- | --- |
| 紧凑读取与等待 | `task_brief_get`、`task_briefs_list`、`tasks_watch` |
| 任务与队列 | `task_submit`、`task_list`、`task_get`、`task_events`、`task_wait`、`task_cancel`、`queue_get` |
| 验证、审核与交付 | `task_verify`、`task_review`、`task_export`、`task_integration_check`、`task_patch_export` |
| 项目与修订 | `project_summary_get`、`task_revision_history`、`task_revision_prepare`、`task_revision_submit` |
| 执行器、模型与额度 | `agents_list`、`models_list`、`model_preference_get`、`model_preference_set`、`execution_policy_get`、`execution_policy_set`、`usage_get` |
| 能力来源 | `capabilities_list`、`capabilities_refresh` |

## 日常协作

完整流程见 [v0.1 使用与验收手册](docs/v0.1日常使用与验收.md)。提交文件任务示例：

```json
{
  "title": "补充配置说明",
  "prompt": "阅读 README.md，在 docs/config.md 中说明配置项。只修改该文件。",
  "projectPath": "/absolute/path/to/project",
  "allowedFiles": ["docs/config.md"],
  "acceptanceCriteria": ["说明与源代码一致", "没有修改范围外文件"],
  "agent": "qoder-cn",
  "model": "Qwen3.8-Flash",
  "reasoningEffort": "xhigh",
  "mode": "files",
  "timeoutSeconds": 120
}
```

模型目录来自当前 CLI。省略模型时继承保存的默认值，任务创建后固定；支持的思考深度由官方 SDK 再次检查，不支持则停止，不静默降档或切换模型。Qwen3.8-Flash 提供低、中、极高选项，初始默认极高。自定义模型按其实际 ID 区分。

优先读取紧凑摘要，按需取完整文件与事件。批量等待最多 8 项、55 秒，只返回版本变化。完成后宿主独立检查，再用 `task_verify` 记录证据，随后 `task_review` 接受或要求返工。依赖仅在前置任务已完成且已接受时放行。

文件任务可对照原始基线检查整合，区分可整合、冲突、已一致和不支持；补丁导出重新核对，网页校验 SHA-256。宿主明确应用补丁，HelmDesk 不自动写回原项目。只读交付输入固定摘要与快照；受控修订保留新旧记录，并通过持久化请求编号避免重复提交。

用量区分 Credits、Tokens、USD、已知零与未知。累计 Credits 阈值只能阻止后续派发，不能限制在途费用，也不代表账号余额。最大轮数可选 1–100，时限 10–600 秒；不会自动重试或续接会话。

## 隔离与数据边界

- 服务仅监听 `127.0.0.1`，检查 Host / Origin；网页写操作使用本机会话与 CSRF，MCP 使用私有连接令牌。
- 服务默认只接受启动目录及子目录的项目；其他根目录须启动前通过 `HELMDESK_PROJECT_ROOTS` 明确配置，macOS 用 `:` 分隔。
- 干净且已有提交的 Git 仓库使用独立 detached worktree，非 Git 项目使用独立副本。任务工作区排除 `.env*`、`.aws`、`.codex`、`.qoder`、依赖及构建目录；拒绝符号链接，限制 2000 文件、单文件 2MB、合计 20MB。
- 执行者只开放 `Read`、`Write`、`Edit`、`Glob`、`Grep`；写入受 `allowedFiles` 限制，没有 Shell、子代理或递归派发工具。OS 隔离检查来源不可读写、快照只读及运行后来源摘要。
- 每项 Qoder 任务使用独立配置目录，以只读引用复用现有登录，不复制登录令牌。执行者的用户设置、原生技能、插件和自动记忆关闭。
- 共享技能与 MCP 须在私有数据目录的 `sharing.json` 显式选择并批准，再按任务选择；[配置示例](docs/sharing.example.json) 使用占位路径且默认未批准。首版仅支持本地 Node stdio、只读工具和禁网网关，不自动转发 OAuth 或宿主管理连接器。
- Markdown 不执行原始 HTML 或加载远程图片；常见认证字段和授权链接在记录事件前脱敏。数据库、日志、凭据、工作副本、提示词与交付可能包含敏感内容，均不属于公开源码。

取消任务会终止当前服务拥有的进程组并保留工作区。服务异常重启后不会自动重试，也不会凭历史 PID 误杀新进程；先核对状态，再决定取消或新建任务。

## 验证与公开范围

```sh
npm run check
npm test
npm run build
```

222 项自动测试使用本地替身、假数据和临时目录，不消耗模型额度。部分测试需要正常宿主权限以监听 loopback 或检查 macOS 沙箱。真实模型任务另外计费，不在自动测试中调用。

公开仓库保留源码、测试、通用文档和示例；运行数据、个人配置、开发聊天、历史任务记录、内部验收脚本、日志和设计草图留在本地。首次公开前检查凭据模式、本机路径、提交清单与构建测试；以后可用 `node scripts/check-publication.mjs` 检查暂存内容。详情见 [公开范围说明](docs/公开范围.md)。

## 界面来源与限制

React 看板包含项目概览、集中验收、Markdown 摘要、折叠差异、时间线及模型/思考深度设置。玻璃导航复用作者博客组件，AeroShards 背景固定于视口；WebGPU 不可用或减少动态效果时降级为静态背景。

来源与第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。公开源码不改变第三方许可，原创部分未另行指定统一开源许可证；`private: true` 阻止误发布到 npm。

当前面向 macOS 本机单用户；Ollama 仅支持已安装本地模型的单轮无工具任务。尚不支持远程访问、自动合并/发布、无人值守续跑、Claude/Gemini 适配器或更高并发。
