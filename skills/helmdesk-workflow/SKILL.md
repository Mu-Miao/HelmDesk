---
name: helmdesk-workflow
description: 当用户要求用 HelmDesk 调度 CLI Agent（尤其 Qoder）执行限定文件或只读任务，并由宿主独立验证、验收和报告交付时使用。不用于泛泛的代码修改，也不用于纯看板样式调整。
---

# HelmDesk 调度、验证与验收

你（宿主）负责拆解、派发、独立验证、验收和报告。执行者在 HelmDesk 隔离工作区完成**一个**明确范围的任务；执行完成不等于验证通过，更不等于验收接受。

## 角色与权限

- 只有宿主可派发、验证和验收。不要把本 Skill 共享给执行者，也不要让执行者调用派活或验收工具，避免递归派发和伪造证据。
- 用户选择优先。默认主要执行器为 `qoder-cn`，沿用领航台保存的模型和思考深度；不要自动切换执行器、模型或凭据。`antigravity` 按明确的辅助分工使用，不能默认替换 Qoder。
- 用户已授权范围内的派发、验证和验收可直接完成，不必每一步重复确认。合并、发布、上架和自动重试不在默认授权内。
- Skill 指导不能代替 HelmDesk 实际执行的沙箱、文件范围和交付版本门禁。

## 预检

1. 确认 HelmDesk MCP 已连接。工具以服务器工具名表示，如 `queue_get`、`task_submit`；宿主可能显示命名空间前缀，以当前连接的 schema 为准，不要照搬前缀。
2. 只读检查：`queue_get` 看槽位和阻塞原因，`agents_list` 确认 CLI 可用，`model_preference_get` 读取默认模型；需要核对可用性时再用 `models_list`。需要共享能力时才读 `capabilities_list`，简单文件任务可显式关闭共享。
3. 确认 `projectPath` 在已授权根目录内。Git 项目须为干净且已有提交的仓库根；非 Git 项目使用独立副本。有未提交改动时先保护现场，不要丢弃或擅自提交用户工作。派发前记录原项目基线，确认宿主能读取交付并运行所需检查。
4. 工具缺失或连接失败时，如实报告连接问题，不声称已派发，不编造任务编号或结果。

## 限定范围派发

- 用 `task_submit` 提交单个任务。`allowedFiles` 写明确的相对路径；`acceptanceCriteria` 写成可客观核对的条件，避免“符合要求”这类无法验证的表述。
- Qoder 文件任务用 `mode: "files"`；辅助只读共享任务可用 `shared`；`probe` 是无工具模式，不能代替文件任务。`capabilities` 按需显式选择；显式空列表表示关闭共享能力。不要为了预检自行发起真实模型兼容性探测。
- 省略 `model` 和 `reasoningEffort` 以沿用保存的默认值，除非用户明确指定。不要用辅助执行器替换默认主执行器。
- 保持 `projectPath` 与文件范围不变；需要返工先报告问题，不自动重试。用户明确要求修订时，再读取修订工具 schema；恢复边界见工具示例末尾。

## 紧凑等待

- 记录 `task_submit` 返回的任务对象 `id`，后续作为 `taskId` 参数传入；先用 `task_brief_get` 读取摘要和 `version`。
- 用 `tasks_watch` 批量等待，单次最多 55 秒；携带上次的 `version`，只接收变化项。`timedOut: true` 表示窗口内无变化，不是失败，用同一任务和最新版本继续等待，不要重新提交。
- 摘要只用于判断是否需要深入；它不替代 `task_get` 和完整文件检查。
- `failed`、`cancelled` 或 `waiting_user` 时报告实际状态与原因，保留现场；停止等待这次执行，不自动重试或另建替代任务。

## 宿主独立验证

- 用 `task_get` 读取完整任务、`changes`、工作区路径、摘要、错误和用量。进入 `completed` 只说明执行结束。
- 在隔离工作区读取**完整交付文件**，不只阅读摘要或截断差异；核对内容逐条满足 `acceptanceCriteria`，确认 `changes` 只涉及允许范围。
- 由宿主实际运行必要的文件或命令检查，并记录真实命令与真实输出。命令没有执行，就不得写 `command` 或声称通过。
- 对照派发前基线确认原项目未被执行者改动；演示任务还应满足原仓库干净、目标文件未出现。确认工作区就是本次任务的独立副本，并核对交付字节数和 SHA-256 与任务记录相符。
- 交付发生变化后，旧证据不能继续放行；必须基于当前版本重新检查。`verification.status` 为 `not_run` 或缺少当前 `deliveryVersion` 时不能验收通过。

## 验收与交付报告

- 验证通过：调用 `task_verify`，`status: "passed"`，写入实际执行的命令和证据。仅当 `task_get` 显示的当前交付与检查对象一致时才能记录。
- 检查不通过：记录 `failed` 与具体问题；HelmDesk 会标记需要返工，再调用 `task_review` 给出 `changes_requested`。
- 验收通过：调用 `task_review`，`acceptance: "accepted"`。只有 `state: "completed"`、验证 `passed` 且绑定当前交付版本时才可接受；`not_run` 不能直接接受。`failed` 不能接受。
- 报告分开写：执行状态、宿主验证证据、验收结论、未执行检查、用量与未知项。缺失或为零的用量不等于免费，不承诺 token 或费用节省。
- 默认只报告可审阅交付和补丁建议。用户明确授权整合后，才使用整合预检与补丁导出；不自动合并、发布或上架。失败不自动重试，也不自动更换执行器、模型或凭据。

按需读取：

- 最小调用与负面示例：[references/tool-examples.md](references/tool-examples.md)
- 安装、宿主前提与本地验证：[references/setup-and-validation.md](references/setup-and-validation.md)
