# 工具调用示例

以下均为**格式示例**，不是已执行记录。尖括号、`/absolute/path/...` 和示例任务编号必须替换；示例命令没有在编写本文件时执行，不能把示例文本当作验证证据。

工具使用服务器工具名（如 `task_submit`）。宿主可能显示命名空间前缀，以当前连接的 schema 为准。

## 1. 最小文件任务

只创建一个两行文件，固定内容：

```json
{
  "title": "创建演示 HELLO.md",
  "prompt": "仅在项目根目录创建 HELLO.md，使用 UTF-8（无 BOM），恰好两行。第一行：你好，这是 HelmDesk 演示文件。第二行：由 Qoder 执行，由 Codex 验证并验收。两行都以一个 LF 换行结束，包括文件末尾。不要添加空行、引号或代码围栏，不修改其他文件。",
  "projectPath": "/absolute/path/to/clean-demo-project",
  "allowedFiles": ["HELLO.md"],
  "acceptanceCriteria": [
    "HELLO.md 的 UTF-8 字节精确对应：你好，这是 HelmDesk 演示文件。\n由 Qoder 执行，由 Codex 验证并验收。\n；LF 换行、含末尾换行，无 BOM 和其他字符",
    "task_get.changes 仅包含 HELLO.md，且 kind 为 added；没有其他文件新增、修改或删除",
    "原演示仓库的 git status --porcelain 输出为空，且仓库根目录不存在 HELLO.md"
  ],
  "agent": "qoder-cn",
  "mode": "files",
  "capabilities": { "skills": [], "tools": [] },
  "timeoutSeconds": 120
}
```

说明：

- 三个 `acceptanceCriteria` 都能通过读取完整文件和实际命令客观核对，避免“符合要求”这类模糊表述。
- 显式 `capabilities` 空列表关闭共享能力。示例故意省略 `model`、`reasoningEffort`，以沿用领航台保存的默认模型和思考深度；也省略了可选的 `dependencies`、`inputs`、`maxTurns`。
- `projectPath` 的占位不可直接执行；必须换成已授权根目录下干净、已有提交的独立 Git 仓库绝对路径。
- `task_submit` 返回完整任务，其中 `id` 用作后续的 `taskId` 参数，`state` 初始通常为 `queued`。

## 2. 紧凑等待

先用 `task_brief_get` 取摘要与版本：

```json
{ "taskId": "<task-submit 返回的任务编号>" }
```

随后用 `tasks_watch` 等待变化。第一次调用可省略 `version`；之后携带上次返回的 `version`：

```json
{
  "targets": [
    { "taskId": "<任务编号>", "version": "<上次返回的 64 位 version>" }
  ],
  "timeoutMs": 30000
}
```

- `tasks_watch` 最多 8 项，单次最多等待 55 秒；只返回 `version` 变化的紧凑摘要。
- 返回 `timedOut: true` 且 `items` 为空，表示窗口内无变化，**不是任务失败**。用同一任务和最新已知版本继续等待，不要重新 `task_submit`。
- 只有 `items` 中出现变化时才读取摘要；摘要仍不能替代完整验证。
- 任务为 `failed`、`cancelled` 或 `waiting_user` 时停止等待并报告原因，不自动新建或重试。

## 3. 读取完整证据并独立验证

```json
{ "taskId": "<任务编号>" }
```

用 `task_get` 检查 `state`、`acceptance`、`verification`、`changes`、`workspace`、`summary`、`error` 和 `usage`。`state: "completed"` 只表示执行结束。

宿主应对**当前交付**做独立检查。以下命令是待执行的格式示例，尖括号必须替换：

```sh
cat "<workspace>/HELLO.md"
shasum -a 256 "<workspace>/HELLO.md"
git -C "<projectPath>" status --porcelain
test ! -e "<projectPath>/HELLO.md" && echo "original-absent"
```

核对点：

- 完整读取 `HELLO.md`，确认恰好两行、逐字匹配验收条件，而不是只看摘要或截断差异。
- `task_get.changes` 只能有 `HELLO.md` 一项且 `kind` 为 `added`；实际文件的 SHA-256 和字节数应与 `changes` 中的 `sha256`、`bytes` 一致。
- 原项目 `git status --porcelain` 应为空，原项目根目录不应出现 `HELLO.md`；派发前保存的 `README.md` 内容与 HEAD 也应保持一致。
- 记录实际执行的命令和真实输出摘要；命令没有执行，就不得声称通过。

## 4. 记录验证

验证通过时，`command` 写实际命令，`evidence` 写实际输出与逐条结论：

```json
{
  "taskId": "<任务编号>",
  "status": "passed",
  "command": "cat \"<workspace>/HELLO.md\" && shasum -a 256 \"<workspace>/HELLO.md\" && git -C \"<projectPath>\" status --porcelain",
  "evidence": "实际执行上述命令后填写：完整文件恰好两行且与验收条件逐字一致；SHA-256 与 changes[0].sha256 一致；changes 仅 HELLO.md（added）；原项目 status 为空且无 HELLO.md。"
}
```

- 上述内容是字段格式示例，括号和结论必须在本次真实执行后替换，不能原样提交。
- `passed` 会绑定当前 `deliveryVersion`。之后交付若变化，旧验证失效，必须重新检查。
- 检查失败时用 `status: "failed"` 并写明真实问题；HelmDesk 会同时把验收标记为 `changes_requested`。

## 5. 验收

仅当任务为 `completed`、验证为 `passed` 且绑定当前交付版本时：

```json
{
  "taskId": "<任务编号>",
  "acceptance": "accepted",
  "note": "已读取当前版本完整文件并执行上述检查：仅 HELLO.md 新增，内容符合三条验收条件，原项目未变，同意接收。"
}
```

- `not_run` 不能直接 `accepted`；缺少当前版本验证时 HelmDesk 会拒绝。
- `failed` 不能 `accepted`；应使用 `changes_requested` 并保留具体问题。
- 验收不会自动合并或写回原项目。用户未授权整合时，只报告可审阅交付。

## 负面示例

1. **执行完成但检查失败**：`state: "completed"`，但文件多出第三行或原项目出现改动。调用 `task_verify` 记 `failed` 与真实证据（这会自动标记返工），再调用 `task_review` 记 `changes_requested`。不得记 `passed` 或 `accepted`。
2. **工具缺失或 MCP 未连接**：如实报告“未派发，连接或工具不可用”，不伪造 `taskId`、不声称任务已运行，也不改换凭据或执行器重试。
3. **等待超时**：`tasks_watch` 返回 `timedOut: true` 且无变化，这只是观察窗口结束。继续等待同一任务，不重新提交，也不判定失败。
4. **只有部分变化或只有摘要**：摘要提到“已完成”不等于范围正确。先 `task_get` 并读取完整文件；发现范围外文件或内容不符，按失败处理，不能仅凭摘要验收。
5. **交付在验证后变化**：`task_get` 的 `changes` 哈希与已记录证据不一致，或 `verification.deliveryVersion` 不再匹配当前交付。旧证据失效，必须重新验证；不得沿用旧 `accepted`。
6. **验证为 `not_run`**：可以继续检查并随后记录，但不能直接验收通过。

## 返工与在途阻塞

实际文件与 `changes` 记录的哈希或字节数不一致时，将本次检查记为 `failed`、验收记为 `changes_requested` 并报告不一致；不能靠重写任务记录、补填摘要或再次声明 `passed` 修复可信来源。保留旧交付。用户明确要求返工后，可读取 `task_revision_prepare` 的 schema 准备修订，再按返回的预览和 `task_revision_submit` schema 提交；提交会发起新的模型请求，不是只读操作，不自动进行。

在途任务没有聊天澄清或原地扩展文件白名单的入口。遇到必须扩大范围的建议时，先报告具体阻塞，不修改原项目、任务参数或另派替代任务。仅当用户明确要求取消、修订或改变范围后，才按当前工具契约处理；修订沿用原文件范围，新增范围需要另行授权的新任务。
