# Naut

[English](README.md) | 简体中文

Naut 是基于 **Tauri v2** 的 mobile-first DeepSeek API 聊天客户端，面向 Android 和 Windows。它 fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，并保留原有静态 Web 构建。

应用没有自建后端，客户端直接请求配置的 API 服务。首次使用前，请在设置中填写 API Key。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用。
- 附件上传、语音输入与回复朗读；Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、历史导入导出。
- 移动端原生体验：安全区布局、软键盘适配、44px 触控区、Android 返回键、应用内图片预览、系统保存对话框。

## 环境要求

- Node.js 22.12+ 和 pnpm。
- Rust 1.90+（当前开发环境为 1.96）。
- Windows 桌面构建：MSVC C++ Build Tools 和 WebView2。
- Android 构建：JDK 17、Android SDK Platform 37、Build-Tools、NDK **29.0.13846066**。
- 本仓库不构建 iOS；iOS 需要 macOS 和 Xcode。

## 安装与运行

~~~sh
pnpm install
pnpm dev          # 浏览器预览 http://localhost:8090
pnpm build        # 静态 Web 产物 dist/
~~~

桌面：

~~~sh
pnpm tauri dev
pnpm tauri build
~~~

Android：

~~~powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME/ndk/29.0.13846066"

rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

pnpm tauri android build --debug --apk -t aarch64
~~~

Android 工程已提交在 **src-tauri/gen/android**。除非该目录缺失，否则不要再次执行 **pnpm tauri android init**：它会重新生成原生工程，可能覆盖清单和主题定制。

debug APK 位于 **src-tauri/gen/android/app/build/outputs/apk/**。真机调试需要开启开发者选项和 USB 调试，连接后执行 **pnpm tauri android dev**（或用 adb 安装 APK）。Android WebView 调试入口是 Chrome 的 **chrome://inspect**。

如果 SDK 把 Android 37 暴露为 **android-37.0**，构建前确保存在名为 **android-37** 的平台目录或 junction。

Windows ARM64 上如果宿主 C++ 编译报 MSVC **D8050**，构建前设置 **$env:CC_PREFER_CLANG_CL_OVER_MSVC = "1"**。

## 移动端行为

- **安全区**：viewport 使用 **viewport-fit=cover**，布局消费 **env(safe-area-inset-*)**。Tauri Android 的 edge-to-edge 会让顶栏避开状态栏、输入框避开导航栏。建议使用 Chromium 140+ 的 Android System WebView，旧版本可能拿不到 inset。
- **软键盘**：页面跟随 **visualViewport** 收缩；输入框聚焦时底部安全区归零，避免键盘上方多出空白。
- **返回键**：Android 返回依次关闭图片预览、菜单/选择器、弹窗、搜索面板、侧栏；在根页面停止生成和朗读后退出。
- **文件**：历史导入导出和附件保存使用系统对话框；导入的 ZIP 先复制进应用沙箱再校验。图片在应用内全屏预览。
- **外部链接**：校验后交给系统浏览器；Rust 侧阻止 WebView 被外部链接带离应用。
- **存储**：API Key 和设置保存在 app-private localStorage，会话和附件原件保存在 IndexedDB；Android 系统备份已关闭。Web 版和原生版 origin 不同，跨端迁移请使用历史导出/导入。

## 目录

~~~text
src/
  app/                 布局、主题与全局样式
  components/          聊天、设置、Markdown、文件与基础 UI
  platform/            Tauri 运行时适配（外链、文件、返回键）
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、分支、存储与历史导入导出
    markdown/          Markdown 解析、高亮与图表
    speech/            录音与朗读
  utils/               通用工具
src-tauri/             Tauri 壳、capabilities、图标与 Android 工程
  plugins/             固定版本的官方 Tauri 插件（构建兼容说明见其 README）
~~~

API 地址默认是 **https://api.deepseek.com**，可通过 [rspack.config.ts](rspack.config.ts) 的 **createConfig({ apiOrigin })** 修改。聊天使用 Anthropic 兼容的 Messages / Files API，语音使用 ASR / TTS 接口。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| **pnpm dev** | 浏览器开发服务器 |
| **pnpm build** | 构建静态产物到 dist/ |
| **pnpm type** | TypeScript 类型检查 |
| **pnpm lint** | oxlint |
| **pnpm format** | oxfmt |
| **pnpm tauri dev** | 桌面开发模式（HMR） |
| **pnpm tauri build** | Windows 安装包 |
| **pnpm build:android** | Android debug APK |
| **pnpm build:android:release** | Android release APK（需签名） |

## 已知限制

- 不包含 iOS 工程与 App Store 构建。
- 未配置 release 签名、Play Store 上架和自动更新。
- 安全区依赖较新的 Android WebView；旧版本可能把内容画到状态栏下面。
- 系统栏图标跟随系统深浅色；应用主题与系统相反时对比度可能不足。
- 大型 ZIP 导入会先把文件读入内存。
- API Key 未加密，仅依赖 app-private 存储隔离。
- Android debug APK 使用正式 applicationId；发布前请妥善保管签名密钥。

## 许可证

[MIT](LICENSE)。Naut fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，原项目同样使用 MIT 许可证。分发时请一并保留许可证。
