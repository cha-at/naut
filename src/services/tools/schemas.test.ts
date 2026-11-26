import { describe, expect, it } from 'vitest'
import {
  buildTools,
  buildToolset,
  hasClientTools,
  hasTool,
  isClientToolName,
  readTool,
  editTool,
  listTool,
  searchModeFor,
  withoutSearch,
  type ToolSettings,
} from './schemas.js'

const settings = (overrides: Partial<ToolSettings> = {}): ToolSettings => ({
  toolsEnabled: true,
  toolRead: true,
  toolEdit: true,
  toolSearch: false,
  toolCapabilities: {},
  ...overrides,
})

describe('工具集构造', () => {
  it('默认顺序为 list、read、edit', () => {
    expect(buildToolset(settings())).toEqual(['list', 'read', 'edit'])
  })

  it('总开关关闭时为空，即使单项仍开启', () => {
    expect(buildToolset(settings({ toolsEnabled: false }))).toEqual([])
  })

  it('单项全关时为空数组，不报错', () => {
    expect(buildToolset(settings({ toolRead: false, toolEdit: false }))).toEqual([])
  })

  it('只开读取时包含 list 与 read', () => {
    expect(buildToolset(settings({ toolEdit: false }))).toEqual(['list', 'read'])
  })

  it('只开编辑时只有 edit', () => {
    expect(buildToolset(settings({ toolRead: false }))).toEqual(['edit'])
  })

  it('开启搜索时追加 search，顺序最后', () => {
    expect(buildToolset(settings({ toolSearch: true }))).toEqual(['list', 'read', 'edit', 'search'])
  })

  it('能力降级时工具集仍保留 search，由独立接口声明', () => {
    const degraded = settings({
      toolSearch: true,
      toolCapabilities: { serverWebToolsWithClientTools: false },
    })
    expect(buildToolset(degraded)).toEqual(['list', 'read', 'edit', 'search'])
  })

  it('能力降级后只保留搜索时仍可声明联网工具', () => {
    const degraded = settings({
      toolRead: false,
      toolEdit: false,
      toolSearch: true,
      toolCapabilities: { serverWebToolsWithClientTools: false },
    })
    expect(buildToolset(degraded)).toEqual(['search'])
  })

  it('没有记录降级时搜索与客户端工具共存', () => {
    expect(buildToolset(settings({ toolSearch: true }))).toContain('search')
  })

  it('能力标记来自其他 API 源时忽略，重新尝试组合', () => {
    const stale = settings({
      toolSearch: true,
      toolCapabilities: {
        apiOrigin: 'https://example.invalid',
        serverWebToolsWithClientTools: false,
      },
    })
    expect(searchModeFor(['list', 'read', 'search'], stale.toolCapabilities)).toBe('server')
  })

  it('同一 API 源记录不兼容时改用独立 Search / Fetch 接口', () => {
    expect(
      searchModeFor(
        ['list', 'read', 'edit', 'search'],
        { apiOrigin: 'https://api.deepseek.com', serverWebToolsWithClientTools: false }
      )
    ).toBe('client')
    // 只声明联网工具时不存在组合冲突，仍用内置工具
    expect(
      searchModeFor(
        ['search'],
        { apiOrigin: 'https://api.deepseek.com', serverWebToolsWithClientTools: false }
      )
    ).toBe('server')
  })

  it('buildTools 在 client 模式下声明 web_search / web_fetch', () => {
    expect(buildTools(['list', 'search'], 'client').map((tool) => tool.name)).toEqual([
      'list',
      'web_search',
      'web_fetch',
    ])
    expect(buildTools(['search']).map((tool) => tool.name)).toEqual([
      'deepseek_web_search',
      'deepseek_read_url',
    ])
  })
})

describe('工具声明', () => {
  it('客户端工具不携带 type，schema 与规格一致', () => {
    expect(listTool).not.toHaveProperty('type')
    expect(listTool.name).toBe('list')
    expect(readTool.input_schema.required).toEqual(['file_path'])
    expect(readTool.input_schema.properties.limit.maximum).toBe(2000)
    expect(editTool.input_schema.required).toEqual(['file_path', 'old_string', 'new_string'])
    expect(editTool.input_schema.additionalProperties).toBe(false)
  })

  it('buildTools 按工具集展开服务端工具', () => {
    const tools = buildTools(['list', 'read', 'search'])
    expect(tools.map((tool) => tool.name)).toEqual([
      'list',
      'read',
      'deepseek_web_search',
      'deepseek_read_url',
    ])
  })

  it('withoutSearch 只去掉联网工具', () => {
    expect(withoutSearch(['list', 'read', 'edit', 'search'])).toEqual(['list', 'read', 'edit'])
  })

  it('hasClientTools 与 hasTool', () => {
    expect(hasClientTools(['search'])).toBe(false)
    expect(hasClientTools(['list', 'search'])).toBe(true)
    expect(hasClientTools(undefined)).toBe(false)
    expect(hasTool(['list', 'read'], 'read')).toBe(true)
    expect(hasTool(['list'], 'read')).toBe(false)
    expect(isClientToolName('list')).toBe(true)
    expect(isClientToolName('search')).toBe(false)
  })
})
