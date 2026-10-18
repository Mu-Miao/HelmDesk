# 博客效果组件来源

组件经作者的 [mashu-blog](https://github.com/Mu-Miao/mashu-blog) 复用到 HelmDesk。原博客不随本项目分发，本目录不包含个人配置或运行数据。

- `GlassSurface.tsx` / `.css`：玻璃表面、SVG 位移与 RGB 折射；对应 React Bits Glass Surface，保留主题及 CSS 降级。
- `ShapeWaves.tsx` / `.css`：博客中的 WebGPU 波纹参考实现，目前未用于主背景。
- `WavesCanvas.tsx`：Canvas 降级参考实现，适配本项目 CSS 并清理媒体查询监听，目前未用于主背景。

当前背景由 `../BlogBackdrop.tsx` 使用 AeroShards，导航仍使用 GlassSurface。第三方版权与完整许可见根目录 `THIRD_PARTY_NOTICES.md`；组件作为 HelmDesk 应用的一部分保留，不作为独立组件库分发。
