# HelmDesk 协作分工

- Codex 负责统筹、任务拆解、验证、验收和最终整合。
- Qoder 是主要执行器，沿用领航台保存的主要模型；不因增加辅助执行器而自动替换。
- Antigravity 是辅助执行器，保留已保存的默认模型，用于分析、摘要和建议。通过 HelmDesk 指定 `agent: "antigravity"`、`mode: "shared"`，与 Qoder 共用已批准的 Skills 快照和只读 MCP 默认值，不开放原生文件或命令工具；`mode: "probe"` 仍禁用工具。接口与限制见 `docs/antigravity.md`。
- ZCode 是辅助执行器，默认 `GLM-5.3-Flash`，固定使用已登录 BigModel 的 ZCode Start Plan。支持 `probe` / `shared`，不开放原生文件、Shell、插件或记忆；保留独立模型默认值。上游风控或额度失败记录后停止，不反复请求。接口与限制见 `docs/zcode.md`。
- 原始执行、宿主验证和验收分别记录。不得将完成状态或上游返回的零用量解释为已经验收或免费。
- 不自动重试失败任务，不自动更换执行器、模型或凭据。用户在当前会话的明确要求优先。

变更后执行 `npm run check`、`npm test`、`npm run build`。涉及 macOS 沙箱或本机服务的测试需要宿主权限；普通沙箱内无法验证时须分别报告。
