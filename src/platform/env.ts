/** Tauri v2 注入的内部对象；浏览器和测试环境中不存在。 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** WebView 的 UA 仍带 Android 标识，用于只在 Android 上注册系统返回键。 */
export const isAndroid = (): boolean =>
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
