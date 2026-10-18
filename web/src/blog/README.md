# React Bits 效果组件来源

这些视觉效果的原始来源均为 [React Bits](https://github.com/DavidHDev/react-bits)。本目录代码经作者的 [mashu-blog](https://github.com/Mu-Miao/mashu-blog) 中的版本取用并适配到 HelmDesk；博客是中间取用版本，不是原创来源。`blog` 是沿用的目录名称，不表示版权归属。本目录不包含博客内容、个人配置或运行数据。

- `GlassSurface.tsx` / `.css`：玻璃表面、SVG 位移与 RGB 折射；对应 React Bits Glass Surface，保留主题及 CSS 降级。
- `ShapeWaves.tsx` / `.css`：React Bits 波纹效果的 WebGPU 版本，经博客版本取用，目前未用于主背景。
- `WavesCanvas.tsx`：波纹效果的 Canvas 降级适配，使用本项目 CSS 并清理媒体查询监听，目前未用于主背景。

当前背景由 `../BlogBackdrop.tsx` 使用 AeroShards，导航仍使用 GlassSurface。第三方版权与完整许可见根目录 `THIRD_PARTY_NOTICES.md`；组件作为 HelmDesk 应用的一部分保留，不作为独立组件库分发。
