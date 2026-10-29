# 在领航台安装 CLI

Mac 应用的“工具来源 → 选择并安装 CLI”、窗口底栏“CLI 安装”、菜单“执行端 → CLI 安装…”和设置“CLI 安装”均打开同一个安装管理界面。

## 先检查 Homebrew

打开界面后会检测 Homebrew 和已有 CLI。Homebrew 缺失或版本检查失败时，安装选择不可用。点击“前往 Homebrew 官网”，按照 [brew.sh](https://brew.sh/) 的说明自行在终端安装，再回来点“重新检测”。领航台不会自动执行 Homebrew 安装脚本。

就绪后，勾选缺少的 CLI，点击“安装所选 CLI”。一次只运行一个安装队列，按选择顺序执行；日志和当前结果会显示在窗口内。已安装的 CLI 会保留，不自动重装或升级。正在排队或运行任务时，先处理任务，再启动安装。

| 执行器 | 安装来源 | 安装后需要做什么 |
| --- | --- | --- |
| Qoder CN | [官方独立 CLI 安装器](https://docs.qoder.cn/cli/installation) | 在 Qoder 官方 CLI 中登录，重新检查模型目录 |
| Antigravity | [Homebrew antigravity-cli](https://formulae.brew.sh/cask/antigravity-cli) | 运行 agy 完成 Google 登录 |
| Ollama | [Homebrew ollama](https://formulae.brew.sh/formula/ollama) | 自行启动本地服务、选择并下载需要的模型 |
| ZCode | [Homebrew ZCode App](https://formulae.brew.sh/cask/zcode) | 在 App 中登录 BigModel，CLI 来自其内置运行时 |

ZCode 安装到当前用户的 `~/Applications`，与系统 `/Applications` 中的已装版本一并检测。Homebrew 的 Apple Silicon 与 Intel 常见路径均支持，即使从访达启动应用、PATH 没有加载 shell 配置，也能检测相关 CLI。

## 结果、取消与失败

- 命令结束后重新探测安装位置；退出码为零但未发现 CLI，仍显示安装未确认。
- “已安装”不表示已登录、有额度、后台服务已启动或真实模型请求已验收。
- 安装不会更改默认执行器、模型或现有登录信息；Ollama 不会自动启动服务或下载模型。
- 关闭安装窗口不终止本机服务中的安装；重新打开可继续查看。
- 点击“取消安装”先通知安装程序退出，留出两秒清理时间，仍未退出时终止本次安装拥有的进程组。已经完成的组件保留，Homebrew 的缓存或不完整组件可能需要按其说明处理。
- 失败或取消后不会自动重试或换来源。日志中的权限、Command Line Tools、网络或管理员授权问题，应按官方说明在终端解决后再明确重试。
- 浏览器页面只提供指引；实际安装必须由 Mac 原生界面发起。

## 实现边界

安装接口仅位于 `/api/desktop/installer-*`，沿用私有本机 bearer 身份，不接受浏览器会话。MCP 工具没有安装入口。网页链接只允许同源主框架中的用户点击打开原生窗口，不能传递安装命令。

后端只接受四个固定执行器 ID，使用固定命令、包名和官方 URL，不接受任意命令、软件包或下载地址。子进程使用清理后的环境，不继承模型 Key、注册表令牌、shell 启动注入和 Node 调试参数。安装日志限制为 64 KiB 并脱敏；每条命令有时限，取消与超时清理其拥有的进程组和临时安装脚本。服务退出前会结束安装和检测进程。
