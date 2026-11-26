# 官方 Android 客户端 UI 移植说明

目标：把 DeepSeek 2.9.0 Android 客户端的界面用 React 重做，功能仍由 Naut 自己的服务层提供。
两处指定差异：品牌位用 Naut 的波潮标记（`assets/naut-icon.svg`），图标全部换成 `lucide-react`。

参考材料：`F:\decomps\docs\ui-design.md`、`F:\decomps\docs\porting-guide.md`、`F:\decomps\out\ui-src`、
`F:\decomps\screenshots`（1080×2392 截图，按 3x 换算）。

## 1. 令牌层

- `src/app/tokens.css`：官方色板与 Material3 字号 / 圆角。色值来自设计文档 §3.2，并与截图采样校正。
- `src/app/aliases.css`：把 `--ds-*` 接到既有的 `--dsw-*` 别名上，组件 CSS 不需要改名字就能换肤。
- 新组件只消费 `--ds-*`；`theme.css` 里的字体族、静态色阶保持不变。

深色实测值（截图采样）：

| 语义                     | 值                                | 用在                             |
| ------------------------ | --------------------------------- | -------------------------------- |
| 页面底（聊天 / 抽屉）    | `#0F0F0F`                         | `.frame`、抽屉、输入区外沿       |
| 设置页底                 | `#1E1E1E`                         | `SettingsPage`                   |
| 容器                     | `#292929`                         | 设置卡片、抽屉搜索框、工具行胶囊 |
| 输入容器                 | `#242424`                         | `ChatInput` 外壳                 |
| 高容器 / 菜单 / 高亮行   | `#3C3C3D`                         | 上下文菜单、选中会话行           |
| 用户气泡                 | `#333333`                         | `UserMessage`                    |
| 选中芯片                 | 底 `#283142` / 描边与字 `#6799FE` | 深度思考 / 智能搜索              |
| 正文 / 思考标题 / 次文本 | `#E1E2EC` / `#B9BABB` / `#8E9094` | 消息、设置                       |

浅色沿用设计文档：品牌 `#426EFE`、页面 `#FFFFFF`、设置页 `#F5F5F5`、容器 `#F8F8F8`、气泡 `#F4F9FF`。

## 2. 组件映射

| 官方（Compose）                                            | Naut（React）                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ChatPageTopBar` + `NavigationIcon` + `TopBarTitleContent` | `components/session/TopBar.tsx`（标题随滚动收缩）                               |
| `ChatPageBottomBar` / `ChatInputActionBar`                 | `components/chatInput/ChatInput.tsx`                                            |
| `ChatInputToggleableToolView`（附件面板）                  | `components/chatInput/InputToolSheet.tsx`                                       |
| `ChatWelcomeLogo` + `ShiningText`                          | `components/brand/NautLogo.tsx` + `Welcome.tsx`                                 |
| `AssistantChatMessageCell`（fragment 列表）                | `AssistantMessage` + `ReplyArea`（thinking / search / open / find / read_link） |
| `UserChatMessageCell`                                      | `UserMessage`（右对齐气泡）                                                     |
| `GotoBottomButton`                                         | `components/messages/GotoBottomButton.tsx`                                      |
| `DSNavigationDrawer` + `ChatSessionListContent`            | `components/sider/Drawer.tsx`（搜索、月份分组、多选、置顶、账户行）             |
| `ContextMenuContent`                                       | 复用 `base/Menu` 的 `popup` 变体                                                |
| `SettingsPageContent`                                      | `components/settings/SettingsPage.tsx` + `SettingsSheet.tsx`                    |
| `AutoTtsButton`                                            | 顶栏喇叭开关（`settings.ttsAuto`）                                              |
| 图标（自带 SVG）                                           | `components/base/icons.tsx`：全部用 lucide-react 实现，导出名保持兼容           |

## 3. 已知偏差

- 参考截图混用了两套深色底（`#0F0F0F` 与 `#1E1E1E`/`#292929`）；这里固定成「聊天/抽屉 `#0F0F0F`、设置页 `#1E1E1E`」，
  因此抽屉右侧被遮住的聊天页会比截图略暗。
- 官方的汉堡图标是两横，lucide 的 `Menu` 是三横，按「换成 Lucide」的要求保留三横。
- 顶栏喇叭对应"回答结束自动朗读"，受浏览器自动播放策略限制时静默失败，手动朗读按钮始终可用。
- 桌面端（≥1024px）沿用 Naut 原有侧边栏 + 居中布局，只继承同一套令牌，不逐像素对齐官方手机界面。
- 字号缩放（设置里的「字体大小」）在小屏用 `transform: scale()` 施加在外壳上；桌面端不生效，用浏览器缩放代替。
- 官方独有能力（语音通话 / FluidBlob、自研相机、登录注册、年龄门、分享选中态）不在本次范围内。

## 4. 验收方式

```powershell
pnpm type
pnpm lint
pnpm build
pnpm dev   # http://localhost:8090
```

移动端断点：宽度 ≤767px 或高度 ≤520px。截图对照脚本用 Chrome headless + CDP（Node 自带 WebSocket），
在 390×844、DPR 3 的视口下分别截欢迎态 / 会话 / 抽屉 / 设置 / 浅色 / 桌面；桌面视口 1440×900。
