# AeroShards 来源与适配

来自用户提供的 React Bits AeroShards JavaScript + CSS，使用 `vgpu`。第三方版权与完整许可见根目录 `THIRD_PARTY_NOTICES.md`。

保留 WGSL 和交互实现；保存为 TSX，以 ts-nocheck 保持上游 JavaScript 形式，移除 Vite 不需要的 Next.js use client 指令。

BlogBackdrop 固定铺满视口，内容滚动时背景位置不变；延迟加载 GPU 模块，适配深浅主题。桌面 1300 碎片、DPR 上限 1.5；手机 650 碎片、DPR 上限 1。缺少 WebGPU、初始化失败或系统偏好减少动态效果时显示静态 CSS 碎片，保留页面隐藏/离屏暂停及销毁清理。
