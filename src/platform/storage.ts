import { isTauri } from './env.js'

/** 尽力申请持久化存储，降低 WebView 在空间紧张时清理会话的概率。 */
export const requestPersistentStorage = (): void => {
  if (!isTauri() || !navigator.storage?.persist) {
    return
  }
  void navigator.storage.persist().catch(() => {})
}
