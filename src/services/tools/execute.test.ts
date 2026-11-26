import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryService } from '../memory/index.js'
import { resetWebMemoryDatabase } from '../memory/web.js'
import type { ClientToolUseBlock } from '../chat/types.js'
import { executeTool, type ExecuteContext } from './execute.js'
import type { Toolset } from './schemas.js'

const block = (name: string, input: unknown, extra: Partial<ClientToolUseBlock> = {}): ClientToolUseBlock => ({
  type: 'tool_use',
  id: `tool_${name}`,
  name,
  input,
  ...extra,
})

const context = (toolset: Toolset = ['list', 'read', 'edit'], observed: string[] = []): ExecuteContext => ({
  toolset,
  observed: new Set(observed),
  toolUseId: 'tool_1',
  apiKey: 'test-key',
  question: '今天有什么新闻',
})

const fetchMock = vi.fn()
const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response
const fail = (status: number, body: unknown) =>
  ({
    ok: false,
    status,
    statusText: 'Error',
    text: async () => JSON.stringify(body),
  }) as unknown as Response

beforeEach(async () => {
  await resetWebMemoryDatabase()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('工具集与参数校验', () => {
  it('未声明的工具返回 not enabled', async () => {
    const result = await executeTool(block('read', { file_path: 'USER.md' }), context(['search']))
    expect(result).toMatchObject({ isError: true, content: 'Error: tool not enabled' })
  })

  it('list 随 read 一起声明，未声明 read 时 list 不可用', async () => {
    const result = await executeTool(block('list', {}), context(['edit']))
    expect(result.content).toBe('Error: tool not enabled')
  })

  it('流式 JSON 非法时返回 invalid tool input', async () => {
    const result = await executeTool(block('read', {}, { invalid: true }), context())
    expect(result).toMatchObject({ isError: true, content: 'Error: invalid tool input' })
  })

  it('参数不符合 schema 时报错', async () => {
    expect((await executeTool(block('list', { extra: 1 }), context())).content).toBe(
      'Error: invalid tool input'
    )
    expect(
      (await executeTool(block('read', { file_path: 'USER.md', offset: 0 }), context())).content
    ).toContain('offset must be an integer')
    expect(
      (await executeTool(block('read', { file_path: 'USER.md', limit: 5000 }), context())).content
    ).toContain('limit must be an integer')
    expect(
      (await executeTool(block('edit', { file_path: 'USER.md', old_string: '' , new_string: 'x' }), context())).content
    ).toBe('Error: old_string must not be empty')
  })

  it('路径逃逸被拒绝，且不读取内容', async () => {
    for (const path of ['../secret.md', 'sub/notes.md', 'C:\\\\Windows\\\\win.ini', '.hidden.md', 'a\\u0000b.md']) {
      const result = await executeTool(block('read', { file_path: path }), context())
      expect(result.isError).toBe(true)
      expect(result.content).toContain('Error: file_path must be a file name inside the memory directory')
    }
  })
})

describe('read / list 执行', () => {
  it('read 成功返回带行号文本并把文件加入观察集合', async () => {
    await memoryService.write('USER.md', '第一行\n第二行')
    const ctx = context()
    const result = await executeTool(block('read', { file_path: 'USER.md' }), ctx)
    expect(result.isError).toBe(false)
    expect(result.content).toContain('1: 第一行')
    expect(result.content).toContain('2: 第二行')
    expect(result.content).toContain('(Showing lines 1-2 of 2.)')
    expect(ctx.observed.has('USER.md')).toBe(true)
    expect(result.display).toMatchObject({
      file: 'USER.md',
      lines: 2,
      totalLines: 2,
      startLine: 1,
      preview: '第一行\n第二行',
    })
  })

  it('read 分页参数生效', async () => {
    await memoryService.write('USER.md', Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'))
    const result = await executeTool(block('read', { file_path: 'USER.md', offset: 11, limit: 5 }), context())
    expect(result.content).toContain('11: line 11')
    expect(result.content).toContain('15: line 15')
    expect(result.content).toContain('(Showing lines 11-15 of 30. Use offset=16 to continue.)')
  })

  it('read 不存在的文件返回错误并标记存储错误', async () => {
    const result = await executeTool(block('read', { file_path: 'notes.md' }), context())
    expect(result.isError).toBe(true)
    expect(result.storageError).toBe(true)
    expect(result.content).toContain('Error:')
  })

  it('list 返回两份记忆文件与标注', async () => {
    const result = await executeTool(block('list', {}), context())
    expect(result.isError).toBe(false)
    expect(result.content).toContain('Memory directory: 2 files')
    expect(result.content).toContain('USER.md')
    expect(result.content).toContain('[memory, auto-injected]')
  })
})

describe('独立联网工具', () => {
  it('web_search 调用独立接口并返回结果，未开启搜索时不可用', async () => {
    const disabled = await executeTool(block('web_search', { query: 'q' }), context(['list', 'read', 'edit']))
    expect(disabled.content).toBe('Error: tool not enabled')

    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          {
            title: 'DeepSeek V4',
            url: 'https://example.com/v4',
            snippet: '短摘要',
            summary: '长摘要',
            site_name: 'Example',
            date: '2026-06-01T00:00:00+00:00',
            authority: 3,
          },
        ],
      })
    )
    const ctx = context(['list', 'read', 'edit', 'search'])
    const result = await executeTool(block('web_search', { query: 'deepseek v4' }), ctx)
    expect(result.isError).toBe(false)
    expect(result.content).toContain('Web search results for "deepseek v4"')
    expect(result.content).toContain('DeepSeek V4')
    expect(result.content).toContain('https://example.com/v4')
    expect(result.content).toContain('长摘要')
    expect(result.display).toMatchObject({
      query: 'deepseek v4',
      results: [{ title: 'DeepSeek V4', url: 'https://example.com/v4', date: '2026-06-01T00:00:00+00:00' }],
      truncated: false,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/tools/search')
    expect(JSON.parse(String(init.body))).toMatchObject({
      query: 'deepseek v4',
      ori_question: '今天有什么新闻',
    })
  })

  it('web_search 参数校验与空结果', async () => {
    const ctx = context(['search'])
    expect((await executeTool(block('web_search', { query: '   ' }), ctx)).content).toBe(
      'Error: query must be 1-128 characters'
    )
    expect((await executeTool(block('web_search', { query: 'q', count: 0 }), ctx)).content).toBe(
      'Error: count must be an integer between 1 and 20'
    )
    fetchMock.mockResolvedValueOnce(ok({ results: [] }))
    const empty = await executeTool(block('web_search', { query: 'nothing' }), ctx)
    expect(empty.isError).toBe(false)
    expect(empty.content).toBe('No web results found for "nothing".')
  })

  it('web_fetch 返回标题与正文预览，并校验 URL', async () => {
    const ctx = context(['list', 'read', 'edit', 'search'])
    for (const url of ['ftp://example.com/a', 'https://user:pass@example.com', 'not a url']) {
      const invalid = await executeTool(block('web_fetch', { url }), ctx)
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toContain('Error: url must be')
    }
    fetchMock.mockResolvedValueOnce(ok({ title: '页面标题', content: '# 正文\n\n更多内容' }))
    const result = await executeTool(block('web_fetch', { url: 'https://example.com/a' }), ctx)
    expect(result.isError).toBe(false)
    expect(result.content).toContain('页面标题')
    expect(result.content).toContain('URL: https://example.com/a')
    expect(result.content).toContain('# 正文')
    expect(result.display).toMatchObject({
      url: 'https://example.com/a',
      title: '页面标题',
      preview: '# 正文\n\n更多内容',
      truncated: false,
    })
  })

  it('联网接口错误转成错误结果且不计入存储失败', async () => {
    fetchMock.mockResolvedValueOnce(
      fail(429, { error: { message: 'QPS limit exceeded', type: 'rate_limit', param: null, code: 'rate_limit' } })
    )
    const result = await executeTool(block('web_search', { query: 'q' }), context(['search']))
    expect(result.isError).toBe(true)
    expect(result.content).toBe('Error: QPS limit exceeded')
    expect(result.storageError).toBeFalsy()
  })
})

describe('edit 执行', () => {
  it('记忆文件无需先读即可编辑，结果包含替换处数', async () => {
    await memoryService.write('MEMORY.md', '偏好：深色主题')
    const ctx = context()
    const result = await executeTool(
      block('edit', {
        file_path: 'MEMORY.md',
        old_string: '偏好：深色主题',
        new_string: '偏好：浅色主题',
      }),
      ctx
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('Edited MEMORY.md: replaced 1 occurrence')
    expect(result.display?.replacements).toBe(1)
    expect(result.display?.backupId).toBeTruthy()
    expect((await memoryService.readFull('MEMORY.md')).content).toBe('偏好：浅色主题')
    expect(ctx.observed.has('MEMORY.md')).toBe(true)
  })

  it('额外文件必须先 read 才能 edit', async () => {
    const result = await executeTool(
      block('edit', { file_path: 'notes.md', old_string: 'a', new_string: 'b' }),
      context()
    )
    expect(result.content).toBe('Error: read the file before editing')
    expect(result.storageError).toBeFalsy()
    // 加入观察集合后才进入存储层，此时才报文件不存在
    const after = await executeTool(
      block('edit', { file_path: 'notes.md', old_string: 'a', new_string: 'b' }),
      context(['list', 'read', 'edit'], ['notes.md'])
    )
    expect(after.isError).toBe(true)
    expect(after.storageError).toBe(true)
  })

  it('replace_all 与零匹配错误', async () => {
    await memoryService.write('USER.md', 'a a a')
    const all = await executeTool(
      block('edit', { file_path: 'USER.md', old_string: 'a', new_string: 'b', replace_all: true }),
      context()
    )
    expect(all.isError).toBe(false)
    expect(all.content).toContain('replaced 3 occurrences')
    const none = await executeTool(
      block('edit', { file_path: 'USER.md', old_string: 'zzz', new_string: 'b' }),
      context()
    )
    expect(none).toMatchObject({ isError: true, storageError: false })
    expect(none.content).toContain('Error:')
  })

  it('写入后超限返回存储错误', async () => {
    await memoryService.write('USER.md', `a${'x'.repeat(64 * 1024 - 1)}`)
    const result = await executeTool(
      block('edit', { file_path: 'USER.md', old_string: 'a', new_string: 'aa' }),
      context()
    )
    expect(result.isError).toBe(true)
    expect(result.storageError).toBe(true)
    expect(result.content).toContain('64 KiB')
  })
})
