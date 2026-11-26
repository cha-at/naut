import { create } from 'zustand'
import {
  closeSettings,
  openSettings,
  type SettingsSection,
} from '../settings/settingsDialogState.js'

/**
 * 个性化页的页面状态：整页覆盖设置，页面内可进入人格编辑器与记忆编辑器。
 * 关闭后重新打开设置界面并回到进入时的分组（桌面端弹窗、移动端设置页共用同一状态）。
 */

export type PersonalizationView =
  | { kind: 'main' }
  | { kind: 'persona'; personaId?: string }
  | { kind: 'memory'; name: string }

type PersonalizationState = {
  open: boolean
  view: PersonalizationView
  returnSection: SettingsSection
}

export const usePersonalization = create<PersonalizationState>(() => ({
  open: false,
  view: { kind: 'main' },
  returnSection: 'general',
}))

/** 设置页 / 设置弹窗里的「个性化」行，返回时用于恢复焦点 */
export const PERSONALIZATION_ENTRY_ID = 'settings-personalization-row'

export const openPersonalization = (returnSection: SettingsSection) => {
  usePersonalization.setState({ open: true, view: { kind: 'main' }, returnSection })
  // 页面完全覆盖设置，先收起设置避免下层闪动
  closeSettings()
}

export const closePersonalization = () => {
  const { returnSection } = usePersonalization.getState()
  usePersonalization.setState({ open: false, view: { kind: 'main' } })
  openSettings(returnSection)
  // 设置界面重新挂载后把焦点放回入口行
  requestAnimationFrame(() => {
    document.getElementById(PERSONALIZATION_ENTRY_ID)?.focus({ preventScroll: true })
  })
}

/** 子页的返回拦截：返回 true 表示已处理（例如弹出了未保存确认） */
type BackGuard = () => boolean

let backGuard: BackGuard | null = null

export const setPersonalizationBackGuard = (guard: BackGuard | null) => {
  backGuard = guard
}

/** 返回按钮与 Android 返回键共用：先给子页拦截的机会，再回主页面，最后关闭页面 */
export const requestPersonalizationBack = () => {
  if (backGuard?.()) {
    return
  }
  if (closePersonalizationView()) {
    return
  }
  closePersonalization()
}

/** 返回键 / 返回按钮：子页先回主页面；返回 true 表示已处理 */
export const closePersonalizationView = (): boolean => {
  if (usePersonalization.getState().view.kind === 'main') {
    return false
  }
  usePersonalization.setState({ view: { kind: 'main' } })
  return true
}

export const showPersonaEditor = (personaId?: string) =>
  usePersonalization.setState({ view: { kind: 'persona', personaId } })

export const showMemoryEditor = (name: string) =>
  usePersonalization.setState({ view: { kind: 'memory', name } })

export const backToPersonalizationMain = () =>
  usePersonalization.setState({ view: { kind: 'main' } })
