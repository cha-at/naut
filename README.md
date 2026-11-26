# Naut

English | [简体中文](README.zh-CN.md)

Naut is a mobile-first chat client for the DeepSeek API, packaged with **Tauri v2** for Android and Windows. It is a fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) and keeps the original static web build working.

There is no application backend: the app talks directly to the configured API service. Enter an API key in Settings before the first chat.

## Features

- Multiple conversations with automatic titles, renaming, deletion, prompt editing, regeneration, and message branches.
- Streaming replies, deep thinking, web search, link reading, and source citations.
- Personalization page with multiple personas (one active persona, snapshotted per conversation), per-tool switches, and memory file management.
- Long-term memory: `USER.md` and `MEMORY.md` snapshots are injected into every new conversation; the model can list, read and edit memory files with client tools, and the latest model edit per file can be undone.
- Attachments, voice input, and read-aloud replies. Markdown, syntax highlighting, KaTeX, and Mermaid.
- Simplified Chinese and English, light/dark themes, mobile layouts, and history import/export.
- Mobile-first shell behavior: safe-area layout, keyboard-aware input, touch-sized controls, Android hardware back handling, in-app image preview, and native file save dialogs.

## Requirements

- Node.js 22.12+ and pnpm.
- Rust 1.90+ (the project is developed with 1.96).
- Windows desktop builds: MSVC C++ Build Tools and WebView2.
- Android builds: JDK 17, Android SDK Platform 37, Build-Tools, and NDK **29.0.13846066**.
- iOS is not built in this repository; it requires macOS and Xcode.

## Install and run

~~~sh
pnpm install
pnpm dev          # browser preview at http://localhost:8090
pnpm build        # static web build in dist/
~~~

Desktop:

~~~sh
pnpm tauri dev
pnpm tauri build
~~~

Android:

~~~powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME/ndk/29.0.13846066"

rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

pnpm tauri android build --debug --apk -t aarch64
~~~

The Android project is checked in under **src-tauri/gen/android**. Do not run **pnpm tauri android init** again unless that directory is missing: it regenerates the native project and can overwrite the manifest and theme customizations.

The debug APK is written under **src-tauri/gen/android/app/build/outputs/apk/**. To run on a USB device, enable developer options and USB debugging, connect the device, then use **pnpm tauri android dev** (or install the APK with adb). Android WebView debugging is available from Chrome's **chrome://inspect** page.

If the SDK is installed through a package manager that exposes Android 37 as **android-37.0**, make sure a platform directory or junction named **android-37** resolves to it before building.

On Windows ARM64, if the host C++ step fails with MSVC error **D8050**, set **$env:CC_PREFER_CLANG_CL_OVER_MSVC = "1"** before the Android build.

## Mobile behavior

- **Safe areas:** the viewport uses **viewport-fit=cover** and the layout consumes **env(safe-area-inset-*)**. Android edge-to-edge therefore keeps the header below the status bar and the input above the navigation bar. Modern Android System WebView (Chromium 140+) is recommended for reliable inset values.
- **Keyboard:** the frame follows **visualViewport**, and the bottom safe area collapses while an input is focused.
- **Back button:** Android back closes the image viewer, menus/selects, modals, the personalization page (sub-pages first), the search panel, settings, and the side drawer in that order. At the root it stops active replies and exits.
- **Files:** history import/export and attachment saving use native dialogs. Picked archives are copied into the app sandbox before validation. Images open in an in-app full-screen preview.
- **External links:** links are validated and opened in the system browser. Top-level navigation away from the app is blocked in Rust.
- **Storage:** the API key, settings and personas stay in app-private localStorage; conversations and original attachments stay in IndexedDB. Memory files live in `~/.naut` on Windows and in the app-specific external directory on Android; the web build stores two fixed documents in the `naut-memory` IndexedDB database. Android system backup is disabled. Use history export/import to move conversations between builds, and the persona/memory backup controls to move personas and memory, because the web and native builds have different origins.

## Personalization, memory and tools

- **Personas:** the personalization page keeps several personas (name + instructions). One persona is active; a new conversation snapshots the active persona and both memory files, and keeps that snapshot for its lifetime. Editing or deleting a persona does not change existing conversations.
- **Tools:** the composer's tool button is the master switch for all tools. The personalization page has three switches: read memory (also enables the file list tool), edit memory, and smart search. All requests omit `safety_check`; server-side content checks still apply.
- **Web search vs. memory tools:** the tested API rejects combining memory tools with built-in web search. When that happens the app keeps both capabilities by switching web search to two client tools, `web_search` and `web_fetch`, which call the standalone `POST /v1/tools/search` and `POST /v1/tools/fetch` endpoints with the same API key. The incompatibility is recorded per API origin and the fallback is explained in Personalization (successful searches and fetches are billed separately, $0.75 per 1,000 requests each; failed or empty requests are not billed). **Retry built-in web tools** clears the marker if the API later supports the combination. Search queries and fetched URLs are sent to DeepSeek's search service.
- **Memory directory:** the native build manages a flat directory of UTF-8 text files (create `.md` files, rename, delete, edit, copy the path). `USER.md` and `MEMORY.md` cannot be renamed or deleted and are always injected as snapshots (16 KiB each). The web build exposes only those two documents.
- **Model edits:** the model calls `list`, `read` and `edit`. Edits are literal replacements (`old_string` must be unique unless `replace_all` is set), limited to 64 KiB per file, and applied atomically with one undo slot per file. A file other than the two memory files must be read in the same reply before it can be edited.
- **Limits:** 200 files per directory, 64 KiB per file, 2,000 lines or 32 KiB per `read` result, and 12 tool execution rounds per reply.

## Project layout

~~~text
src/
  app/                 layout, themes, global styles
  components/          chat, settings, Markdown, files, and base UI
  platform/            Tauri runtime adapters (external links, files, back button)
  services/
    api/               API requests, SSE, and protocol types
    chat/              conversations, branches, storage, history import/export
    markdown/          Markdown parsing, highlighting, diagrams
    speech/            recording and read-aloud playback
  utils/               shared utilities
src-tauri/             Tauri shell, capabilities, icons, Android project
  plugins/             pinned official Tauri plugins (build workaround, see README)
~~~

The API origin defaults to **https://api.deepseek.com** and is injected by **createConfig({ apiOrigin })** in [rspack.config.ts](rspack.config.ts). Chat uses the Anthropic-compatible Messages / Files APIs; speech uses the ASR / TTS endpoints.

## Development commands

| Command | Purpose |
| --- | --- |
| **pnpm dev** | Browser development server |
| **pnpm build** | Static build into dist/ |
| **pnpm type** | TypeScript type check |
| **pnpm lint** | oxlint |
| **pnpm test** | Vitest unit and component tests |
| **pnpm format** | oxfmt |
| **pnpm tauri dev** | Desktop app with HMR |
| **pnpm tauri build** | Windows installer |
| **pnpm build:android** | Debug Android APK |
| **pnpm build:android:release** | Release APK (requires signing) |

## Known limitations

- No iOS project or App Store build.
- No release signing, Play Store listing, or auto-update.
- Safe-area insets depend on a modern Android WebView; older WebViews may draw under the status bar.
- System bar icon contrast follows the system theme; forcing the app theme opposite to the system may reduce contrast.
- Large ZIP imports are read into memory before validation.
- The API key is stored unencrypted in app-private storage.
- The model can edit memory files directly; only the latest model edit per file can be undone, and clearing site data removes web memory.
- On Android the external memory directory may not be visible to every third-party file manager.
- The Android debug APK uses the same application id as a future release build; keep signing keys safe before publishing.

## License

[MIT](LICENSE). Naut is a fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), also MIT licensed. Include the license when distributing the app.
