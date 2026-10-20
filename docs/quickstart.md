---
title: HelmDesk 快速上手：让 Codex 调度 Qoder，交付过程看得见
slug: helmdesk-quickstart
tags: [HelmDesk, Codex, Qoder, AI协作, 开发工具]
status: published
---

把任务交给另一个 AI 之后，麻烦往往才开始：它改了哪些文件？说完成了，真的通过检查了吗？原项目有没有被动过？最后怎么把交付接回来？

HelmDesk（领航台）把这段过程放进本机工作台：Codex 负责拆解、验证和审核，Qoder 在独立工作区执行，领航台记录队列、差异、结果和用量。这篇教程从安装开始，跑通一个只创建 Markdown 文件的小任务。

项目源码：[Mu-Miao/HelmDesk](https://github.com/Mu-Miao/HelmDesk)。本文对应 v0.1，目前面向 macOS 本机单用户。

## 先认清三个角色

| 角色 | 负责什么 |
| --- | --- |
| Codex | 理解目标、明确范围、派发任务、检查证据、决定是否接收和整合 |
| Qoder CN CLI | 在独立工作区完成任务，只使用授权的文件工具 |
| HelmDesk | 建立工作区，调度执行，保存过程，通过 MCP 和网页提供查看入口 |

执行者只开放 Read、Write、Edit、Glob、Grep，没有 Shell 或子代理。需要终端验证时，由宿主运行适合这个项目的检查。**执行完成、验证通过、验收接受分别记录**，不能用一句“做完了”代替后两步。

## 1. 安装并打开看板

准备好 macOS、Git、Node.js 24+，以及已登录的 Qoder CN 官方 CLI 或 Qoder CN App。HelmDesk 复用现有 CLI 登录，不要求额外填写模型 API Key；账号和模型是否可用仍以官方 CLI 为准。

```sh
git clone https://github.com/Mu-Miao/HelmDesk.git
cd HelmDesk
npm ci
npm run build
node dist/cli.js doctor --data-dir .helmdesk
```

`doctor` 探测 CLI、模型目录和基础隔离，不发起模型推理。它汇总各项结果，**不能只看退出码**：

- `agent.status` 为 `fulfilled`，且 `agent.value.available` 为 `true`。
- `models.status` 为 `fulfilled`，并返回当前 CLI 的模型目录。
- `isolation.status` 为 `fulfilled`，且 `isolation.value.verified` 为 `true`。

隔离依赖 macOS 的 `sandbox-exec`，未通过时先处理具体原因，不跳过检查。`doctor` 也不能证明登录后的每个模型都能调用或额度充足。名称相近的 `probe` 会实际调用模型，初次上手不需要运行。

```sh
node dist/cli.js serve --data-dir .helmdesk --concurrency 2
```

保留服务终端，另开交互终端运行 `node dist/cli.js browser --data-dir .helmdesk`，在 60 秒内打开生成的一次性入口。Mac 应用可直接点击“浏览器”。服务只监听本机，示例明确启用两个槽位；默认一个，最大两个。看板用于查看和审核，任务从 MCP 宿主派发。

## 2. 把 MCP 接进 Codex

另开终端，进入刚克隆的 HelmDesk 根目录，执行：

```sh
command -v node
pwd
```

第一条取得 Node 路径，第二条取得项目路径。把下面的占位值替换成实际绝对路径，加入 Codex 的 `~/.codex/config.toml`；已有配置保留，只补充这一项，不要整文件覆盖。

```toml
[mcp_servers.helmdesk]
command = "/absolute/path/to/node"
cwd = "/absolute/path/to/HelmDesk"
args = ["/absolute/path/to/HelmDesk/dist/cli.js", "mcp", "--data-dir", "/absolute/path/to/HelmDesk/.helmdesk", "--autostart-service", "--concurrency", "2"]
```

这是本地 STDIO 服务的配置方式，参见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。**服务和 MCP 的数据目录必须相同**，否则连接不到同一个后台。`--autostart-service` 在首次工具调用时启动缺失的服务；已有服务保持原配置，不会因此自动派发任务。

保存后重新连接 MCP，必要时重新打开聊天或重启客户端。当前应能加载 28 项工具，先让 Codex 调用 `queue_get` 读取队列，再调用 `models_list` 检查可用模型。

如果使用默认安装位置的 macOS 桌面应用，也可在 HelmDesk 根目录先运行 `node scripts/register-codex-mcp.mjs` 检查，再显式加 `--apply` 注册；脚本通过本机官方 CLI 操作，修改前会备份配置。其他安装方式使用上面的手动配置。

## 3. 建一个专用演示仓库

第一次先用小项目验证流程。服务默认只接受启动目录及子目录，Git 项目还必须指向**干净且已有提交的仓库根目录**。HelmDesk 自身也是 Git 仓库，普通子文件夹会被识别到父仓库，因此这里建立一个独立的演示仓库。

在第二个终端的 HelmDesk 根目录运行。每次都会新建不同的目录，不覆盖已有演示文件：

```sh
mkdir -p .helmdesk
helm_demo_dir="$(mktemp -d "$PWD/.helmdesk/demo-project-XXXXXX")"
git -C "$helm_demo_dir" init -q
printf '# HelmDesk demo\n' > "$helm_demo_dir/README.md"
git -C "$helm_demo_dir" add README.md
git -C "$helm_demo_dir" -c user.name='HelmDesk Demo' -c user.email='demo@example.invalid' commit -qm 'Initialize demo'
printf '%s\n' "$helm_demo_dir"
```

最后一行打印的绝对路径就是下一步的 `projectPath`。这里的虚构 Git 身份只用于这一次演示提交，不修改全局身份。`.helmdesk/` 已被忽略，演示仓库不会进入 HelmDesk 的源码提交。

真正的项目若在其他位置，需要启动服务前通过 `HELMDESK_PROJECT_ROOTS` 明确允许，macOS 多个根目录用 `:` 分隔，然后重启服务。不要为了派发去丢弃未提交改动。

## 4. 让 Qoder 创建一个文件

确认 `models_list` 中有 Qwen3.8-Flash，再把下面这段发给 Codex，将项目路径替换为刚才打印的值：

```text
请通过 helmdesk MCP 派发一个文件任务，不要自己直接写文件。

项目路径：替换为演示仓库的绝对路径
执行器：qoder-cn
模型：Qwen3.8-Flash
思考深度：xhigh（极高）
模式：files
允许写入：仅 HELLO.md
超时：120 秒

任务：创建 HELLO.md，第一行写一句中文问候，第二行说明由 Qoder 执行、由 Codex 审核。
验收条件：文件内容符合要求；变更只有 HELLO.md；原项目内容保持不变。

用 task_submit 提交，通过 task_brief_get 和 tasks_watch 等待。
需要完整证据时再取 task_get、task_events，并读取交付文件。
完成后独立核对，调用 task_verify 记录结果，再决定 task_review 是否接受。
遇到失败保留记录，不自动重试或换模型。此时不要应用补丁。
```

模型和思考深度按实际 CLI 目录再校验，不支持会报错，不静默降档。任务创建后选择固定。等待返回空项或超时不等于任务失败；`tasks_watch` 每次最多等待 55 秒，使用上次版本号继续等待变化即可。

任务在独立 worktree 中执行，网页会显示结果、文件差异、验证和验收状态。只看摘要不够，宿主还要读取完整文件，确认只有 `HELLO.md` 改动，并检查原演示仓库仍然干净。对这个 Markdown 任务，读内容、核对差异和原项目比跑一套无关的 npm 测试更合适。

## 5. 收下交付，再明确整合

| 状态 | 含义 |
| --- | --- |
| `completed` | 执行结束 |
| 验证 `passed` | 宿主依据独立检查记录了通过证据 |
| 验收 `accepted` | 宿主决定接收本次交付 |

核对后由 Codex 用 `task_verify` 记录实际检查命令和证据，再调用 `task_review`。检查失败就保留具体问题，不能直接标为接受。

想把 `HELLO.md` 带回演示仓库，再明确告诉 Codex：只选择这个文件，运行 `task_integration_check`，用返回的 fingerprint 调用 `task_patch_export`，审阅补丁并核对 SHA-256，运行 `git apply --check`，通过后再应用。

预检发现冲突、预览过期或交付已变化，会阻止导出。HelmDesk 不自动写回原项目，实际应用由宿主明确执行。应用后回读 `HELLO.md`，再次预检应显示已经一致，避免重复应用。

## 费用和故障，先看这些

Qoder 执行消耗其账号额度，Codex 拆解、阅读和审核也消耗自身额度。把工作拆出去是否更省，取决于上下文和返工，不保证固定比例。Credits、Tokens、USD 分开记录，未知不当零；累计 Credits 阈值只阻止后续派发，不能限制在途费用。

| 遇到什么 | 先做什么 |
| --- | --- |
| Node 版本不符合 | 确认终端和 MCP 指向 Node 24+ |
| CLI 或模型不可用 | 查看 `doctor`，检查官方安装和登录；必要时用 `HELMDESK_QODER_CLI` 指定 CLI |
| 看板打不开或连接失败 | 查看服务终端、端口和绝对数据目录，避免重复启动 |
| MCP 工具还是旧的 | 重新连接，必要时重新打开聊天或重启客户端 |
| Git 或项目路径被拒绝 | 检查允许根、仓库根、首次提交和干净状态 |
| 隔离失败 | 查看具体原因，不跳过沙箱 |

取消任务会保留工作区和历史。异常重启后先核对状态，再决定取消或新建任务，不要通过删除数据库或凭据处理状态问题。`.helmdesk/` 可能保存提示词、项目副本和连接令牌，不要公开上传。

## 后面再用到的入口

- [日常使用与验收手册](https://github.com/Mu-Miao/HelmDesk/blob/main/docs/v0.1%E6%97%A5%E5%B8%B8%E4%BD%BF%E7%94%A8%E4%B8%8E%E9%AA%8C%E6%94%B6.md)：修订、恢复及验收清单。
- [能力共享示例](https://github.com/Mu-Miao/HelmDesk/blob/main/docs/sharing.example.json)：显式批准 Skills 和本地只读 MCP，首次上手不用配置。
- [公开范围](https://github.com/Mu-Miao/HelmDesk/blob/main/docs/%E5%85%AC%E5%BC%80%E8%8C%83%E5%9B%B4.md)：哪些资料只留在本机。

看板的玻璃导航、波纹和碎片效果源自 React Bits，部分版本经博客取用并适配，见 [第三方来源与许可](https://github.com/Mu-Miao/HelmDesk/blob/main/THIRD_PARTY_NOTICES.md)。当前不支持远程访问、自动合并发布、无人值守续跑或 Claude/Gemini 适配；Ollama 仅限已有本地模型的单轮无工具任务。
