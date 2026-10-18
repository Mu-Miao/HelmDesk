# 领航台 · HelmDesk

**让 Codex 调度 Qoder，让每一次交付都有据可查。**

HelmDesk 是一个在本机运行的 CLI Agent 协作工作台。你在 Codex 里描述目标，由它拆解任务、审查结果；Qoder 在独立工作区完成明确范围内的改动；领航台把队列、差异、验证和用量放进同一个中文看板。

**macOS · Node.js 24+ · TypeScript / React · SQLite · 28 项 MCP 工具**

[快速上手](docs/quickstart.md) · [博客教程](https://blog.mashutaba.best/post/helmdesk-quickstart) · [使用与验收手册](docs/v0.1日常使用与验收.md) · [MCP 配置](docs/codex-mcp.toml.example) · [公开范围](docs/公开范围.md)

## 它解决什么问题

把一项工作分给另一个 Agent 后，你仍然需要知道：它改了什么、有没有通过检查、能不能合回原项目，以及用了多少额度。HelmDesk 将这些信息保存在本机，让派发和验收能接上。

```text
你描述目标
    ↓
Codex 拆解任务，通过 MCP 派发
    ↓
HelmDesk 建立独立工作区，记录过程与用量
    ↓
Qoder 执行 → Codex 验证与审核 → 明确整合
```

适合把范围清楚的文档、组件和独立模块交给执行者，再由宿主集中审核。模型执行和 Codex 审核都会消耗各自额度，是否更省取决于任务划分、上下文大小和返工次数。

## 已经可以做什么

| 能力 | 具体行为 |
| --- | --- |
| 派发与协作 | 单槽位或显式双槽位运行，展示排队及依赖阻塞原因 |
| 独立工作区 | 干净 Git 仓库建立 detached worktree，非 Git 项目建立副本 |
| 模型与思考深度 | 从 CLI 目录选模型；Flash 支持低、中、极高，任务创建后固定选择 |
| 可读的交付 | Markdown 摘要、按文件折叠的差异、事件时间线、审核报告 |
| 验证与整合 | 执行、验证、验收分别记录；预检冲突，导出并校验补丁 |
| 项目与修订 | 按项目查看任务和已记录用量，显式修订保留新旧历史 |
| 紧凑读取 | 分页摘要与批量等待减少重复返回，完整证据按需读取 |
| 运行控制 | 时限、可选轮数上限、按执行器和模型区分的累计 Credits 阈值 |

## 先把看板跑起来

需要 **macOS、Git、Node.js 24+**，以及已登录的 **Qoder CN 官方 CLI 或 Qoder CN App**。HelmDesk 复用已有 CLI 登录，不要求额外填写模型 API Key。

```sh
git clone https://github.com/Mu-Miao/HelmDesk.git
cd HelmDesk
npm ci
npm run build
node dist/cli.js doctor --data-dir .helmdesk
```

`doctor` 不调用模型推理。检查输出中 `agent`、`models`、`isolation` 三项均为 `fulfilled`，`agent.value.available` 为 `true`，且 `isolation.value.verified` 为 `true`；进程退出成功并不代表每项探测成功。CLI 登录、模型目录或隔离有问题时，先处理对应原因。

```sh
node dist/cli.js serve --data-dir .helmdesk --concurrency 2
```

保留终端，打开 **<http://127.0.0.1:4317/>**。默认并发为 1，示例明确开启 2；只支持 1 或 2。看板用于查看和审核过程，派发入口在 MCP 宿主中。

后续可用 `npm run dev` 构建并启动单槽位服务；源码修改后需重新构建并重启。不要在同一数据目录重复启动服务。

## 再把 Codex 接进来

在 HelmDesk 根目录执行 `command -v node` 和 `pwd`，取得 Node 与项目的实际路径，再按 [完整配置示例](docs/codex-mcp.toml.example) 设置 stdio MCP：

```toml
[mcp_servers.helmdesk]
command = "/absolute/path/to/node"
cwd = "/absolute/path/to/HelmDesk"
args = ["/absolute/path/to/HelmDesk/dist/cli.js", "mcp", "--data-dir", "/absolute/path/to/HelmDesk/.helmdesk", "--autostart-service", "--concurrency", "2"]
```

占位路径必须替换，`--data-dir` 必须指向服务使用的同一目录。Codex 支持在 `~/.codex/config.toml` 的 `mcp_servers` 表里配置本地 STDIO 服务；入口详见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。保存后重新连接 MCP；若工具目录未刷新，重新打开聊天或重启客户端再检查。

连接后先让 Codex 调用 `queue_get`，确认能读取队列；再检查 `models_list`，选择当前账号实际可用的模型。当前接口共 28 项，完整分类见下方。

<details>
<summary>可选：通过本机官方 CLI 注册</summary>

在 HelmDesk 根目录执行：

```sh
node scripts/register-codex-mcp.mjs
node scripts/register-codex-mcp.mjs --apply
```

第一条检查，第二条才明确注册，并在私有数据目录备份宿主配置。该脚本目前适配默认安装位置的 macOS 桌面应用；安装位置不同请使用上面的手动配置。普通服务和执行者不会修改宿主配置、技能、插件或记忆。

</details>

## 第一次任务，先从一个文件开始

跟随 [快速上手](docs/quickstart.md) 创建专用演示项目，再把这样的要求发给 Codex：

> 用领航台处理这个干净的演示仓库。使用 Qwen3.8-Flash、极高思考深度，只允许创建 HELLO.md。完成后先检查完整文件、差异和原项目是否保持不变，记录验证结果，再决定是否验收；我明确要求整合时才应用补丁。

模型须出现在当前 CLI 目录。任务中的 `projectPath` 使用真实绝对路径，`allowedFiles` 明确到文件。省略模型时继承已保存的默认值；模型和深度创建后固定，不支持的选择会报错，不静默降档或换模型。

日常流程是：

1. **派发**：用 `task_submit` 写清范围、验收条件和时限。
2. **等待**：优先使用摘要和 `tasks_watch`，有变化再读取完整交付。
3. **验证**：宿主检查文件并运行适合该改动的检查，用 `task_verify` 记录命令与证据。
4. **验收**：用 `task_review` 接受或要求返工；依赖只有在前置交付已接受后才放行。
5. **整合**：明确选择文件，预检并导出补丁；宿主审阅、检查后明确应用。

**`completed` 只表示执行结束，不能代替验证或验收。** 冲突、过期预览和变更后的交付会阻止导出；HelmDesk 不自动写回原项目。

## 数据和权限

- **本机访问**：服务仅监听 `127.0.0.1`，检查 Host / Origin，网页写操作使用会话与 CSRF，MCP 使用私有连接令牌。
- **明确项目范围**：默认只接受服务启动目录及子目录；其他位置须启动前通过 `HELMDESK_PROJECT_ROOTS` 明确配置，macOS 用 `:` 分隔。Git 项目必须是干净且已有提交的仓库根目录。
- **受限文件工具**：执行者只开放 `Read / Write / Edit / Glob / Grep`，写入受白名单限制，不开放 Shell、子代理或递归派活。宿主负责终端验证和整合。
- **隔离与过滤**：任务副本排除 `.env*`、凭据和宿主配置目录、依赖及构建产物；拒绝符号链接。当前限制 2000 个文件、单文件 2MB、合计 20MB。Git checkout 后也清除排除项。
- **显式共享**：Skills 和本地只读 MCP 须按 [示例](docs/sharing.example.json) 选择、批准，再逐任务授权；不自动导出宿主配置、OAuth 或登录令牌。
- **保留现场**：取消与失败保留工作副本及历史；异常重启不自动重试，也不凭历史 PID 误杀新进程。

使用 `--data-dir .helmdesk` 时，数据库、日志、任务副本、用量和连接凭据都留在忽略的 `.helmdesk/`。不传数据目录时，macOS 默认写入 `~/Library/Application Support/HelmDesk/`。这些数据可能包含项目内容，不要上传到公开仓库。

## 常见问题

| 情况 | 先检查什么 |
| --- | --- |
| 找不到 CLI 或模型 | 运行 `doctor`，确认官方 CLI/App 已安装并登录；CLI 路径可用 `HELMDESK_QODER_CLI` 指定 |
| 看板能开，MCP 连接失败 | Node/脚本绝对路径、构建输出，以及两边是否使用同一个数据目录 |
| 新工具没有出现 | 重新连接 MCP，必要时重新打开聊天或重启客户端 |
| Git 项目被拒绝 | 是否指向仓库根目录、已有提交且工作区干净；不要为派发丢弃未提交改动 |
| 项目在范围外 | 在启动服务前明确配置 `HELMDESK_PROJECT_ROOTS`，再重启服务 |
| 沙箱检查不通过 | 查看 `doctor` 中的具体原因，当前只支持 macOS；不跳过隔离强行运行 |
| 用量是未知 | 上游没有提供该字段；未知不等于零，不能据此判断免费 |

Credits、Tokens 和 USD 分别记录，任务消耗与账号快照也分开。累计阈值只能阻止后续派发，不能限制已经在途的费用。Ollama 当前只支持已安装本地模型的单轮无工具任务。

## 开发与文档

```sh
npm run check
npm test
npm run build
```

当前 222 项自动测试使用本地替身、假数据和临时目录，不调用真实模型。部分测试需要宿主权限以监听 loopback 或检查 macOS 沙箱。`.npmrc` 禁止依赖安装脚本；`private: true` 防止误发布到 npm。

| 文档 | 内容 |
| --- | --- |
| [快速上手](docs/quickstart.md) | 安装、MCP 接入、演示项目和第一次完整交付，也提供博客版 |
| [日常使用与验收](docs/v0.1日常使用与验收.md) | 操作步骤、恢复处理和验收清单 |
| [MCP 配置](docs/codex-mcp.toml.example) | 本地 stdio 配置模板 |
| [能力共享配置](docs/sharing.example.json) | 显式批准 Skills 与只读 MCP |
| [公开范围](docs/公开范围.md) | 源码与私有资料的边界、提交前检查 |
| [第三方来源与许可](THIRD_PARTY_NOTICES.md) | React Bits 及依赖声明 |

<details>
<summary>28 项 MCP 工具</summary>

| 用途 | 工具 |
| --- | --- |
| 紧凑读取与等待 | `task_brief_get`、`task_briefs_list`、`tasks_watch` |
| 任务与队列 | `task_submit`、`task_list`、`task_get`、`task_events`、`task_wait`、`task_cancel`、`queue_get` |
| 验证、审核与交付 | `task_verify`、`task_review`、`task_export`、`task_integration_check`、`task_patch_export` |
| 项目与修订 | `project_summary_get`、`task_revision_history`、`task_revision_prepare`、`task_revision_submit` |
| 执行器、模型与额度 | `agents_list`、`models_list`、`model_preference_get`、`model_preference_set`、`execution_policy_get`、`execution_policy_set`、`usage_get` |
| 能力来源 | `capabilities_list`、`capabilities_refresh` |

</details>

## 界面来源与当前范围

玻璃导航、波纹和 AeroShards 等视觉效果源自 **React Bits**，部分版本经作者博客取用并适配。碎片背景固定于视口；缺少 WebGPU 或偏好减少动态效果时降级为静态背景。完整版权与条款见 [第三方来源与许可](THIRD_PARTY_NOTICES.md)。原创代码未另行指定统一开源许可证。

v0.1 面向 macOS 本机单用户，已实现 Qoder CN 与受限 Ollama 适配；暂不支持远程访问、更高并发、Claude/Gemini 适配器、自动合并发布或无人值守续跑。
