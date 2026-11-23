import { isWebUrl } from '../utils/url.js'
import { isTauri } from './env.js'

const isMailto = (value: string) => /^mailto:/i.test(value)

/** 应用允许交给系统浏览器处理的链接；其余协议一律忽略。 */
export const isExternalUrl = (value: string) => isWebUrl(value) || isMailto(value)

/** 在系统浏览器中打开链接；Tauri 内不再创建应用窗口。 */
export const openExternal = async (url: string): Promise<void> => {
  if (!isExternalUrl(url)) {
    return
  }
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    // 打不开链接时保持当前页面不变，不把错误抛给聊天流程。
  }
}

/**
 * Tauri 的 WebView 没有浏览器的新标签行为，统一在捕获阶段拦截外链。
 * 返回清理函数，便于 React effect 使用。
 */
export const installExternalLinkInterceptor = (): (() => void) => {
  if (!isTauri()) {
    return () => {}
  }
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) {
      return
    }
    const anchor =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (!anchor || anchor.hasAttribute('download')) {
      return
    }
    if (!isExternalUrl(anchor.href)) {
      return
    }
    event.preventDefault()
    void openExternal(anchor.href)
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
