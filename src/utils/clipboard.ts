import { isTauri } from '../platform/env.js'

export const copyText = async (text: string): Promise<boolean> => {
  if (isTauri()) {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
      await writeText(text)
      return true
    } catch {
      // 原生剪贴板不可用时继续走浏览器兼容路径。
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 剪贴板权限受限时尝试兼容方式。
  }

  // 兼容手机通过局域网 HTTP 访问的情况。
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'

  try {
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
