import { closeTopModal, hasOpenModal } from '../components/base/Modal.js'
import { useImageViewer } from '../components/files/imageViewerState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { stopReply, useChatStore } from '../services/chat/store.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { isAndroid, isTauri } from './env.js'

let exiting = false

const blurFocusedInput = () => {
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active.matches('input, textarea, [contenteditable="true"]')
  ) {
    active.blur()
    return true
  }
  return false
}

const dismissFloatingLayer = () => {
  if (!document.querySelector('[role="menu"], [role="listbox"]')) {
    return false
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return true
}

const exitApp = async () => {
  if (exiting) {
    return
  }
  exiting = true
  stopReadAloud()
  for (const id of Object.keys(useChatStore.getState().streaming)) {
    stopReply(id)
  }
  // 给停止生成后的落盘留一点时间，避免进程立即结束时丢失最后一段回答。
  await new Promise((resolve) => setTimeout(resolve, 200))
  try {
    const { exit } = await import('@tauri-apps/api/app')
    await exit(0)
  } catch {
    exiting = false
  }
}

/**
 * Android 系统返回键：按浮层层级逐层关闭，根页面才退出应用。
 * 只在 Tauri Android 中注册，浏览器和桌面不受影响。
 */
export const installBackHandler = (): (() => void) => {
  if (!isTauri() || !isAndroid()) {
    return () => {}
  }
  let unlisten: (() => void) | undefined
  let disposed = false

  void (async () => {
    try {
      const { onBackButtonPress } = await import('@tauri-apps/api/app')
      const listener = await onBackButtonPress(() => {
        if (blurFocusedInput()) {
          return
        }
        if (useImageViewer.getState().url) {
          useImageViewer.getState().close()
          return
        }
        if (dismissFloatingLayer()) {
          return
        }
        if (hasOpenModal()) {
          closeTopModal()
          return
        }
        if (useSearchPanel.getState().entry) {
          closeSearchPanel()
          return
        }
        if (useMobileSider.getState().open) {
          closeMobileSider()
          return
        }
        void exitApp()
      })
      if (disposed) {
        void listener.unregister()
      } else {
        unlisten = () => void listener.unregister()
      }
    } catch {
      // 非移动运行时或权限不可用时保持浏览器式行为。
    }
  })()

  return () => {
    disposed = true
    unlisten?.()
  }
}
