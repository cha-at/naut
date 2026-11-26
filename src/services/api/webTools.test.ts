import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client.js'
import { fetchWebPage, searchWeb } from './webTools.js'

const fetchMock = vi.fn()

const ok = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as Response

const fail = (status: number, body: unknown) =>
  ({
    ok: false,
    status,
    statusText: 'Error',
    text: async () => JSON.stringify(body),
  }) as unknown as Response

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('独立搜索 / 抓取接口', () => {
  it('search 使用 Bearer 鉴权并解析结果', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          {
            rerank_score: 2.4,
            title: 'DeepSeek V4',
            url: 'https://example.com/v4',
            snippet: '短摘要',
            summary: '长摘要',
            content: '',
            site_name: 'Example',
            site_icon: null,
            date: '2026-06-01T00:00:00+00:00',
            authority: 3,
          },
        ],
      })
    )
    const results = await searchWeb('secret', {
      query: 'deepseek v4',
      count: 5,
      oriQuestion: 'DeepSeek V4 什么时候发布',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/tools/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'deepseek v4',
      count: 5,
      need_content: false,
      ori_question: 'DeepSeek V4 什么时候发布',
    })
    expect(results).toEqual([
      {
        title: 'DeepSeek V4',
        url: 'https://example.com/v4',
        snippet: '短摘要',
        summary: '长摘要',
        siteName: 'Example',
        date: '2026-06-01T00:00:00+00:00',
        authority: 3,
      },
    ])
  })

  it('fetch 返回标题与正文', async () => {
    fetchMock.mockResolvedValueOnce(ok({ title: '页面标题', content: '# 正文' }))
    const page = await fetchWebPage('secret', 'https://example.com/a')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/tools/fetch')
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://example.com/a' })
    expect(page).toEqual({ title: '页面标题', content: '# 正文' })
  })

  it('API 错误体映射为 ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      fail(429, { error: { message: 'QPS limit exceeded', type: 'rate_limit', param: null, code: 'rate_limit' } })
    )
    const error = await searchWeb('secret', { query: 'q' }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(429)
    expect((error as ApiError).message).toBe('QPS limit exceeded')
  })

  it('网络错误映射为 network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await fetchWebPage('secret', 'https://example.com').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('network')
  })

  it('搜索响应格式异常时按空结果处理', async () => {
    fetchMock.mockResolvedValueOnce(ok({ results: 'nope' }))
    await expect(searchWeb('secret', { query: 'q' })).resolves.toEqual([])
  })
})
