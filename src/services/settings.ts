import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 界面字号倍率，对应设置页的「字体大小」；Web 侧施加在外壳上做整体缩放 */
export type FontScale = 0.9 | 1 | 1.15 | 1.3

export const FONT_SCALES: readonly FontScale[] = [0.9, 1, 1.15, 1.3]

/** 接口兼容性标记：仅在与当前 API 源匹配时生效 */
export type ToolCapabilities = {
  /** 写入标记时的 API 源；与当前源不一致时忽略标记 */
  apiOrigin?: string
  /** false 表示该接口不能在同一请求里同时声明客户端工具与服务端联网工具 */
  serverWebToolsWithClientTools?: boolean
}

/**
 * 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考、
 * 工具调用总开关与三个单项开关、侧边栏收起状态。
 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  /** 旧「智能搜索」开关，与 toolSearch 同步；仅为读取旧回复的 search 字段保留 */
  search: boolean
  /** 工具调用总开关：关闭时请求不声明任何工具 */
  toolsEnabled: boolean
  /** 读取记忆 + 文件列表 */
  toolRead: boolean
  /** 编辑记忆 */
  toolEdit: boolean
  /** 联网搜索与阅读链接 */
  toolSearch: boolean
  toolCapabilities: ToolCapabilities
  siderCollapsed: boolean
  fontScale: FontScale
  /** 回答结束后自动朗读；官方顶栏的喇叭开关 */
  ttsAuto: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  /** 旧键，仅迁移读取与回滚兼容；不再作为真实开关 */
  search: 'chat-demo:search',
  toolsEnabled: 'chat-demo:tools-enabled',
  toolRead: 'chat-demo:tool-read',
  toolEdit: 'chat-demo:tool-edit',
  toolSearch: 'chat-demo:tool-search',
  toolCapabilities: 'chat-demo:tool-capabilities',
  siderCollapsed: 'chat-demo:sider-collapsed',
  fontScale: 'chat-demo:font-scale',
  ttsAuto: 'chat-demo:tts-auto',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时使用默认字号 */
const initialFontScale = (): FontScale => {
  const saved = Number(read(KEYS.fontScale))
  return FONT_SCALES.find((scale) => scale === saved) ?? 1
}

const readBoolean = (key: string): boolean | null => {
  const value = read(key)
  return value === 'true' ? true : value === 'false' ? false : null
}

/**
 * 联网搜索的初始值来自旧 chat-demo:search；新键缺失时写入迁移结果，旧键保留不删。
 * 读取旧键失败按 false 处理。
 */
const initialToolSearch = (): boolean => {
  const saved = readBoolean(KEYS.toolSearch)
  if (saved !== null) {
    return saved
  }
  const legacy = readBoolean(KEYS.search) ?? false
  write(KEYS.toolSearch, String(legacy))
  return legacy
}

/** 单项开关缺失即写入默认值，升级用户与全新安装的行为一致 */
const initialToolSwitch = (key: string, fallback: boolean): boolean => {
  const saved = readBoolean(key)
  if (saved !== null) {
    return saved
  }
  write(key, String(fallback))
  return fallback
}

/** 能力标记校验失败时回退空对象，不阻塞启动 */
const initialToolCapabilities = (): ToolCapabilities => {
  try {
    const raw: unknown = JSON.parse(read(KEYS.toolCapabilities) ?? '{}')
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return {}
    }
    const value = raw as Record<string, unknown>
    const capabilities: ToolCapabilities = {}
    if (typeof value.apiOrigin === 'string') {
      capabilities.apiOrigin = value.apiOrigin
    }
    if (typeof value.serverWebToolsWithClientTools === 'boolean') {
      capabilities.serverWebToolsWithClientTools = value.serverWebToolsWithClientTools
    }
    return capabilities
  } catch {
    return {}
  }
}

export const useSettings = create<Settings>(() => {
  const toolSearch = initialToolSearch()
  return {
    apiKey: read(KEYS.apiKey),
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    thinking: read(KEYS.thinking) === 'true',
    search: toolSearch,
    toolsEnabled: initialToolSwitch(KEYS.toolsEnabled, true),
    toolRead: initialToolSwitch(KEYS.toolRead, true),
    toolEdit: initialToolSwitch(KEYS.toolEdit, true),
    toolSearch,
    toolCapabilities: initialToolCapabilities(),
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
    fontScale: initialFontScale(),
    ttsAuto: read(KEYS.ttsAuto) === 'true',
  }
})

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setToolsEnabled = (toolsEnabled: boolean) => {
  write(KEYS.toolsEnabled, String(toolsEnabled))
  useSettings.setState({ toolsEnabled })
}

export const setToolRead = (toolRead: boolean) => {
  write(KEYS.toolRead, String(toolRead))
  useSettings.setState({ toolRead })
}

export const setToolEdit = (toolEdit: boolean) => {
  write(KEYS.toolEdit, String(toolEdit))
  useSettings.setState({ toolEdit })
}

/** 联网搜索开关；同时同步旧键，回滚到旧版本时仍保留用户偏好 */
export const setToolSearch = (toolSearch: boolean) => {
  write(KEYS.toolSearch, String(toolSearch))
  write(KEYS.search, String(toolSearch))
  useSettings.setState({ toolSearch, search: toolSearch })
}

export const setToolCapabilities = (toolCapabilities: ToolCapabilities) => {
  write(KEYS.toolCapabilities, JSON.stringify(toolCapabilities))
  useSettings.setState({ toolCapabilities })
}

/** @deprecated 使用 setToolSearch；保留给旧调用点与回滚兼容 */
export const setSearch = (search: boolean) => setToolSearch(search)

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setFontScale = (fontScale: FontScale) => {
  write(KEYS.fontScale, String(fontScale))
  useSettings.setState({ fontScale })
}

export const setTtsAuto = (ttsAuto: boolean) => {
  write(KEYS.ttsAuto, String(ttsAuto))
  useSettings.setState({ ttsAuto })
}
