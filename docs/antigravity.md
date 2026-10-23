# Antigravity 辅助执行器

Codex 负责拆解、统筹、验证和验收；Qoder 是主要执行器；Antigravity 处理提示词中的独立分析、摘要、解释和建议。Antigravity 默认模型为 `gemini-3.8-flash-high`，保存辅助默认值不会替换主要执行器。它不会自动接管失败或额度耗尽的 Qoder 任务。

## 安装与登录

使用 Google 官方 [安装说明](https://antigravity.google/docs/getting-started?tab=cli) 安装 `agy`，运行 `agy` 并通过 Google OAuth 登录。HelmDesk 复用 macOS 钥匙串登录，不保存 Google OAuth token 或把订阅转成 API Key。CLI 路径可通过 `HELMDESK_AGY_CLI` 明确指定，默认也检查 `~/.local/bin/agy`。

`agents_list` 只探测安装；`models_list` 带 `agent: "antigravity"` 时读取当前账号的完整模型目录，不发送推理请求。模型不存在时拒绝派发，不自动改用其他档位。默认模型的 High 是模型 ID 的一部分，与 Qoder 的 `reasoningEffort` 参数分开。

## 派发

```json
{
  "agent": "antigravity",
  "mode": "probe",
  "title": "辅助分析",
  "projectPath": "/absolute/path/to/clean-project",
  "prompt": "根据以下材料给出三条建议：……",
  "allowedFiles": [],
  "acceptanceCriteria": ["建议与给定材料一致"],
  "maxTurns": 1,
  "timeoutSeconds": 120
}
```

省略 `model` 时使用 Antigravity 独立默认值；原项目仍须满足 HelmDesk 的路径和干净仓库检查。辅助执行器不读取项目内容，宿主须在 prompt 中提供必要材料。不支持文件任务、交付输入、共享 Skills/MCP 或额外执行轮数；文件实现继续选择 Qoder。

`model_preference_get` 可指定 `agent: "antigravity"`。`model_preference_set` 选择 Antigravity 时默认只保存辅助默认值；`makePrimary: true` 才明确替换主要执行器。网页设置按辅助默认值保存。

## 隔离与协议

适配器使用原生 `--gemini_dir` 为每个任务建立独立配置和会话目录，并使用空的任务工作目录，避免加载原项目定制。生成配置不继承宿主 Hooks、MCP、插件、Skills 或脚本；Google 登录由系统钥匙串提供。macOS 沙箱只允许写当前任务目录，原项目、宿主配置与生成的权限配置不可修改，读取也限制到运行时与任务所需路径。

已校准的 CLI 为 1.4.6。该版本的初始化事件会列出内建工具目录，即使自定义 Agent 写了 `tools: []`；目录不能作为授权证据。适配器在提交提示词前核对固定模型、辅助 Agent 和 `strict` 权限模式。生成配置拒绝命令、文件、URL、MCP 操作；headless 不提供自动授权，并在任何工具或未知步骤出现时终止。拒绝操作、未知协议、错误终态及不完整结果不能记为成功。不会传 `--dangerously-skip-permissions`，不会开启额外 AI credits 消耗。

## 用量与验收

Tokens 来自 `agy` 单轮完成事件，分别保留输入、输出、思考、缓存读取和总量；输出 Tokens 可能已含思考 Tokens，不能再次相加。Google 套餐额度、Qoder Credits 与 USD 分开；未提供的余额和费用保持未知。CLI 的一轮用户任务不保证只发生一次底层模型请求，也不是费用硬上限。

执行结束后仍需 `task_verify` 和 `task_review`；成功回复不能代替文件开发验收。官方协议参见 [headless 文档](https://antigravity.google/docs/cli/headless/)。
