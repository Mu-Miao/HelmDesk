# Antigravity 辅助执行器

Codex 负责拆解、统筹、验证和验收；Qoder 是主要执行器；Antigravity 处理提示词中的独立分析、摘要、解释和建议。Antigravity 默认模型为 `gemini-3.8-flash-high`，保存辅助默认值不会替换主要执行器。它不会自动接管失败或额度耗尽的 Qoder 任务。

## 安装与登录

使用 Google 官方 [安装说明](https://antigravity.google/docs/getting-started?tab=cli) 安装 `agy`，运行 `agy` 并通过 Google OAuth 登录。HelmDesk 复用 macOS 钥匙串登录，不保存 Google OAuth token 或把订阅转成 API Key。CLI 路径可通过 `HELMDESK_AGY_CLI` 明确指定，默认也检查 `~/.local/bin/agy`。

`agents_list` 只探测安装；`models_list` 带 `agent: "antigravity"` 时读取当前账号的完整模型目录，不发送推理请求。模型不存在时拒绝派发，不自动改用其他档位。默认模型的 High 是模型 ID 的一部分，与 Qoder 的 `reasoningEffort` 参数分开。

模型目录读取最多等待 30 秒，超时终止而不自动重试。CLI 初始化早期可能先记录未登录、随后成功加载钥匙串；判断登录状态须看后续认证结果，不能仅引用启动期错误。目录预检失败不表示已经发出模型请求。

## 派发

```json
{
  "agent": "antigravity",
  "mode": "shared",
  "title": "辅助分析",
  "projectPath": "/absolute/path/to/clean-project",
  "prompt": "根据以下材料给出三条建议：……",
  "allowedFiles": [],
  "acceptanceCriteria": ["建议与给定材料一致"],
  "maxTurns": 1,
  "timeoutSeconds": 120
}
```

省略 `model` 时使用 Antigravity 独立默认值；省略 `mode` 时使用 `shared`。原项目仍须满足 HelmDesk 的路径和干净仓库检查。辅助执行器不读取项目内容，宿主须在 prompt 中提供必要材料。不支持文件任务、交付输入或额外用户轮数；文件实现继续选择 Qoder。

## 共用 Skills 和只读 MCP

Qoder 的 `files` / `shared` 与 Antigravity 的 `shared` 使用同一个 HelmDesk 目录、技能快照和只读网关。`sharing.json` 可设置 `defaults: {"agents":["qoder-cn","antigravity"],"skills":["guide"],"tools":["server/tool"]}`；各 ID 必须先列入批准来源。配置只在重启服务后生效，不能扩大已有任务权限。提交时省略 `capabilities` 继承此选择；显式 `{"skills":[],"tools":[]}` 关闭共享。`probe` 始终不继承工具。

`capabilities_list` 展示默认选择与兼容状态。技能按任务相关性通过 `read_skill` 读取，只读 MCP 通过 `call` 调用，固定工具 schema、任务凭证和调用上限。模型默认值不受共享配置影响。任务结束立即撤销网关，核对来源摘要。

本地 MCP 仍要求明确的 Node 运行时、脚本绝对入口和只读声明，并在无网络沙箱运行。推荐 `command: "node"`，始终使用当前服务的 Node，不查询 PATH；源码版与 DMG 内置运行时可共用此配置。旧的绝对命令路径须指向当前服务的 Node，切换运行时前应改为此稳定引用。`remoteServers` 目前仅接受 `https://mcp.context7.com/mcp` 的 `resolve-library-id`、`query-docs` 两个只读查询；使用 [Context7 官方公开接口](https://github.com/upstash/context7/blob/master/server.json)，不继承 API Key、OAuth、自定义请求头或代理环境，不跟随重定向、不自动重连。远端故障会阻止含该能力的任务准备，须由调用者明确排除该能力后创建新任务。

不能直接共享 Codex 内部工具、应用托管连接器的 OAuth、写入 MCP、命令执行器或依赖专属工具的 Skills。兼容检查不能代替来源审查；不应把插件缓存中未启用的技能自动视作已批准来源。本机配置留在忽略的运行目录，不发布个人路径或凭据。

`model_preference_get` 可指定 `agent: "antigravity"`。`model_preference_set` 选择 Antigravity 时默认只保存辅助默认值；`makePrimary: true` 才明确替换主要执行器。网页设置按辅助默认值保存。

## 隔离与协议

适配器使用原生 `--gemini_dir` 为每个任务建立独立配置和会话目录，并使用空的任务工作目录，避免加载原项目定制。生成配置不加载宿主 Hooks、MCP 配置、插件或脚本；共享模式仅注入任务专用的 `helm` MCP 适配器。Google 登录由系统钥匙串提供。macOS 沙箱只允许写当前任务目录，原项目、宿主配置、技能快照与生成的权限配置不可修改，读取也限制到运行时与任务所需路径。独立配置中的 `config/projects` 仅供 CLI 创建当前任务的会话元数据，其余配置继续只读；冷启动验证须从全新目录直接启动，不能先运行会预建项目元数据的 `agy agents` 再判断隔离是否可用。

已校准的 CLI 为 1.4.6。该版本的初始化事件会列出内建工具目录，即使自定义 Agent 写了 `tools: []`；目录不能作为授权证据。适配器在提交提示词前核对固定模型、辅助 Agent 和 `strict` 权限模式。生成配置拒绝命令、文件和 URL 操作；共享模式仅按 [官方 MCP 权限格式](https://www.antigravity.google/docs/permissions?tab=cli) 放行 `mcp(helm/read_skill)` 和/或 `mcp(helm/call)`，其余操作无自动授权。`probe` 拒绝全部 MCP。未授权工具、跨会话事件、未知协议、上游错误步骤、错误终态及不完整结果不能记为成功；上游错误终止且不自动重试。不会传 `--dangerously-skip-permissions`，不会开启额外 AI credits 消耗。

## 用量与验收

Tokens 来自 `agy` 单轮完成事件，分别保留输入、输出、思考、缓存读取和总量；输出 Tokens 可能已含思考 Tokens，不能再次相加。Google 套餐额度、Qoder Credits 与 USD 分开；未提供的余额和费用保持未知。CLI 的一轮用户任务不保证只发生一次底层模型请求，也不是费用硬上限。

执行结束后仍需 `task_verify` 和 `task_review`；成功回复不能代替文件开发验收。官方协议参见 [headless 文档](https://antigravity.google/docs/cli/headless/)。
