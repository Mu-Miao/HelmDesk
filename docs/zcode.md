# ZCode 辅助执行器

HelmDesk 使用官方 ZCode Agent CLI 的 `app-server` / `workspace/generateText` 协议。已核对官方 [ZCode 源码与 CLI 说明](https://github.com/zai-org/ZCode)及本机 App 内的 CLI **0.17.0**。没有安装第三方同名 npm 包，也不把其他 Agent 的参数套在 ZCode 上。

## 使用

1. 安装官方 ZCode macOS App，在 App 中登录 **BigModel**。
2. 在 HelmDesk 的模型设置选择 **ZCode · GLM 辅助**，刷新目录并保存 **GLM-5.3-Flash**。
3. MCP 可明确派发：

```json
{
  "agent": "zcode",
  "title": "分析方案",
  "projectPath": "/absolute/path/to/approved/project",
  "prompt": "根据下面给出的材料指出风险与改进建议……",
  "acceptanceCriteria": ["建议可核对且没有文件改动"],
  "mode": "probe",
  "allowedFiles": [],
  "maxTurns": 1,
  "timeoutSeconds": 120
}
```

省略 `model` 使用 ZCode 独立默认值 `GLM-5.3-Flash`。省略 `mode` 使用 `shared`；仅允许任务已选择的技能快照和只读 MCP。共享默认值通过 `sharing.json` 的 `defaults.agents` 显式加入 `zcode`，已有配置不会自动增加授权对象。显式空 `capabilities` 数组关闭共享。修改文件仍交给 Qoder。

运行时发现顺序：`HELMDESK_ZCODE_CLI` → PATH 的 `zcode` → `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` → 用户 Applications 中的同一路径。必须保留完整官方运行时和随包 `config/provider/zcode-builtin.json`。当前适配 0.17.x；不支持的版本会拒绝执行。

## 模型与账号边界

- 默认模型 ID 是官方目录中的 **`GLM-5.3-Flash`**，请求和结果均检查完整 ID。
- 目前固定 **`account:bigmodel-start-plan`**，使用 ZCode 自身 Start Plan；不自动改用个人付费 Coding Plan、通用 API 余额、团队套餐或其他账号。是否有可用额度以官方服务的实际判定为准。
- 使用 GLM 原生 `low` 推理档，不接受 Qoder 的 `reasoningEffort` 参数。一次任务只有一轮用户输入，最多 8 次模型请求；这不是金额或 Tokens 硬上限。
- Qoder、Antigravity 与 ZCode 的默认值分开持久化，保存 ZCode 默认模型不会自动替换主要执行器。
- Tokens 按任务内实际返回用量累加；未提供的 Credits、货币费用、套餐余额保持未知，不展示为免费或零消耗。

## 隔离和认证

宿主只读取官方 ZCode 已保存的本机加密认证，按官方格式在内存解密产品 JWT。仅在 CLI 反向请求的账号、模型和工作区与当前任务匹配时，经 stdin 返回本次请求认证。不会修改官方配置、创建 API Key，或把账号凭据复制到任务目录。JWT 必须进入所选官方 CLI 的内存，这依赖对官方运行时的信任。

CLI 在 macOS sandbox-exec 中运行，使用空的任务专用 HOME、数据、日志和临时目录；无法读取原项目、官方账号目录、Codex/Qoder 配置或其他任务。模型请求不注册原生文件、命令、插件、记忆、调度或子代理工具。共享工具由宿主经既有网关执行，沿用已批准工具/schema、路径、哈希与调用次数检查。超时和取消清理本任务持有的进程组；失败不自动重试、不更换模型或套餐。

包装层不保存原始协议或 stderr，只保留明确选择的会话、用量、工具事件和经过归类的失败原因。官方 CLI 自身的日志行为属于外部运行时边界；发布验证会检查已产生的任务文件是否包含实际认证值。

## 本次验证

2026-10-25 的真实 GLM-5.3-Flash / ZCode Start Plan 请求收到：`request has been blocked due to unusual activity.`，已记录并停止重试。**尚未取得该账号的真实模型成功响应。** 应在官方 ZCode 内处理账号或服务侧状态，再明确发起一次新任务；HelmDesk 不循环尝试绕过风控。

自动测试使用可控协议替身和真正的 macOS 沙箱，覆盖模型/账号固定、辅助默认值持久化、认证内存桥接、原项目与认证文件不可读、共享只读调用、Tokens 累加、模型不符和上游风控失败。替身通过只证明本地接入和限制，不替代真实 GLM 对话验收。
