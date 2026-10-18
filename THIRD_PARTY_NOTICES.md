# 第三方来源与许可

HelmDesk 的原创部分未另行指定统一开源许可证。公开此应用的源码不改变下列第三方条款，也不授予对第三方服务、CLI 或模型的额外权利。

## React Bits

- 上游：[DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)
- 许可：[MIT + Commons Clause License Condition v1.0](docs/third-party/react-bits-LICENSE.md)，保留上游完整原文。
- 涉及：`web/src/effects/AeroShards.tsx`、`AeroShards.css`，以及经作者博客复用的 `web/src/blog/GlassSurface.tsx`、`GlassSurface.css`。
- 适配：React/Vite 的 TSX 包装、主题、布局、固定背景、性能参数与降级。组件作为 HelmDesk 应用的一部分使用。

博客视觉参考及其他波纹实现来自作者的 [Mu-Miao/mashu-blog](https://github.com/Mu-Miao/mashu-blog)。本仓库未包含博客运行配置、内容数据库或账号资料。

## npm 依赖

React、Vite、TypeScript、MCP SDK、Qoder CN Agent SDK、vgpu 及其他依赖通过 `package.json` 和 `package-lock.json` 声明，按各自随包许可证使用。依赖源码、官方 CLI/SDK 二进制、模型及账号凭据不打包进本仓库；Qoder CN SDK 的许可由其发行包中的 `LICENSE` 规定。
