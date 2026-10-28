# 领航针 · HelmDesk 图标

图标由深海蓝圆角底板、朝东北的薄荷色领航针，以及轨道上的三枚协作节点组成。指针表示目标与方向；节点对应各自独立、由宿主统筹的执行器。无文字的几何轮廓便于在 Dock、访达和浏览器页签中辨认。

`script/generate_icon.swift` 是唯一绘制源。它以同一组 Core Graphics 路径、sRGB 颜色和渐变生成网页 SVG 与 10 个 macOS PNG 表示，避免两套图形逐渐分叉。不依赖外部字体、网络、图像模型或第三方绘图库。

```sh
swift script/generate_icon.swift /tmp/helmdesk-icon
cp /tmp/helmdesk-icon/HelmDesk.svg web/public/assets/helmdesk.svg
iconutil -c icns /tmp/helmdesk-icon/HelmDesk.iconset
```

macOS 打包自动生成 ICNS，并比对已提交的 SVG；两者不一致会停止打包。`CFBundleIconFile` 引用 `HelmDesk.icns`，网页导航与 favicon 使用 `/assets/helmdesk.svg`，沿用已有静态资源路由。生成的 PNG、ICNS 和临时目录不提交 Git。

原始画布为 1024 × 1024，底板位于 `(96, 96)`，边长 832。边缘保持透明，为 macOS 图标留出视觉间距。原生表示覆盖 16、32、128、256、512 pt 的 1×/2×；打包审计验证 ICNS 结构、全部表示和网页资源。
