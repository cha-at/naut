import { ApiError } from '../api/client.js'
import { API_ORIGIN } from '../api/origin.js'
import { setToolCapabilities } from '../settings.js'

/**
 * 联网工具兼容性降级：接口不支持把客户端工具与服务端联网工具放在同一请求时，
 * 去掉联网工具重试一次，并记录能力标记（只在同一 API 源下生效）。
 */

const COMPAT_ERROR = /other tools cannot be used together|used together with .*deepseek_web_search/i

/** 400 + 明确的组合不兼容错误文本；其他错误按普通 API 错误处理 */
export const isToolCombinationError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && COMPAT_ERROR.test(error.message)

/** 记录「该 API 源不支持组合」；页面据此禁用搜索开关并常驻说明 */
export const recordWebToolsIncompatible = () =>
  setToolCapabilities({ apiOrigin: API_ORIGIN, serverWebToolsWithClientTools: false })
