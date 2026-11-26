import { ApiError } from './client.js'
import { API_ORIGIN } from './origin.js'

/**
 * 独立的网页搜索与抓取接口（DeepSeek Search / Fetch API）。
 * 当内置服务端联网工具无法与客户端工具同请求时，模型改用这两个客户端工具，
 * 由应用直接调用 POST /v1/tools/search 与 POST /v1/tools/fetch。
 */

export type WebSearchItem = {
  title: string
  url: string
  snippet: string
  /** 供模型阅读的长摘要（约 600–800 字） */
  summary: string
  siteName: string | null
  date: string | null
  authority: number
}

export type WebFetchPage = {
  title: string
  /** Markdown 正文；可能很长，由调用方截断 */
  content: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

const readApiError = async (response: Response): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || response.statusText
  try {
    const body: unknown = JSON.parse(text)
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
      message = body.error.message
    }
  } catch {
    // 非 JSON 错误体直接使用原文
  }
  return new ApiError('http', message, response.status)
}

const postJson = async <T>(
  path: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> => {
  let response: Response
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readApiError(response)
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('protocol', 'Unexpected response from the web tools API')
  }
}

/** 搜索网页；失败抛 ApiError（401/402/429 等由上层显示原始信息） */
export const searchWeb = async (
  apiKey: string,
  {
    query,
    count = 8,
    oriQuestion,
    signal,
  }: { query: string; count?: number; oriQuestion?: string; signal?: AbortSignal }
): Promise<WebSearchItem[]> => {
  const body: Record<string, unknown> = {
    query,
    count,
    // 正文按需再用 web_fetch 读取，避免一次返回过多内容
    need_content: false,
  }
  if (oriQuestion) {
    body.ori_question = oriQuestion.slice(0, 128)
  }
  const data = await postJson<unknown>('/v1/tools/search', apiKey, body, signal)
  const results = isRecord(data) && Array.isArray(data.results) ? data.results : []
  return results.flatMap((item): WebSearchItem[] =>
    isRecord(item) && typeof item.url === 'string'
      ? [
          {
            title: asString(item.title) || item.url,
            url: item.url,
            snippet: asString(item.snippet),
            summary: asString(item.summary),
            siteName: asNullableString(item.site_name),
            date: asNullableString(item.date),
            authority: typeof item.authority === 'number' ? item.authority : -1,
          },
        ]
      : []
  )
}

/** 抓取网页正文（Markdown） */
export const fetchWebPage = async (
  apiKey: string,
  url: string,
  signal?: AbortSignal
): Promise<WebFetchPage> => {
  const data = await postJson<unknown>('/v1/tools/fetch', apiKey, { url }, signal)
  if (!isRecord(data) || typeof data.content !== 'string') {
    throw new ApiError('protocol', 'Unexpected response from the fetch API')
  }
  return { title: asString(data.title), content: data.content }
}
