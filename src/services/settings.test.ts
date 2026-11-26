import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 每次重新加载模块，模拟应用启动时读取 localStorage */
const load = async () => {
  vi.resetModules()
  return import('./settings.js')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.resetModules()
})

describe('工具开关默认值', () => {
  it('全新安装：总开关、读取、编辑默认开启，搜索默认关闭', async () => {
    const { useSettings } = await load()
    const state = useSettings.getState()
    expect(state.toolsEnabled).toBe(true)
    expect(state.toolRead).toBe(true)
    expect(state.toolEdit).toBe(true)
    expect(state.toolSearch).toBe(false)
    expect(state.toolCapabilities).toEqual({})
    // 缺失即写入默认值
    expect(localStorage.getItem('chat-demo:tools-enabled')).toBe('true')
    expect(localStorage.getItem('chat-demo:tool-read')).toBe('true')
    expect(localStorage.getItem('chat-demo:tool-edit')).toBe('true')
    expect(localStorage.getItem('chat-demo:tool-search')).toBe('false')
  })

  it('旧 chat-demo:search 迁移为 tool-search，旧键保留', async () => {
    localStorage.setItem('chat-demo:search', 'true')
    const { useSettings } = await load()
    expect(useSettings.getState().toolSearch).toBe(true)
    expect(useSettings.getState().search).toBe(true)
    expect(localStorage.getItem('chat-demo:tool-search')).toBe('true')
    expect(localStorage.getItem('chat-demo:search')).toBe('true')
  })

  it('新键存在时优先使用新键', async () => {
    localStorage.setItem('chat-demo:search', 'true')
    localStorage.setItem('chat-demo:tool-search', 'false')
    const { useSettings } = await load()
    expect(useSettings.getState().toolSearch).toBe(false)
  })

  it('读取旧键失败按 false 处理', async () => {
    localStorage.setItem('chat-demo:search', 'yes')
    const { useSettings } = await load()
    expect(useSettings.getState().toolSearch).toBe(false)
  })

  it('能力标记损坏时回退空对象', async () => {
    localStorage.setItem('chat-demo:tool-capabilities', 'not json')
    const { useSettings } = await load()
    expect(useSettings.getState().toolCapabilities).toEqual({})
    localStorage.setItem('chat-demo:tool-capabilities', '"string"')
    vi.resetModules()
    const second = await import('./settings.js')
    expect(second.useSettings.getState().toolCapabilities).toEqual({})
  })
})

describe('工具开关写入', () => {
  it('切换后持久化，搜索同时同步旧键', async () => {
    const m = await load()
    m.setToolsEnabled(false)
    m.setToolRead(false)
    m.setToolEdit(false)
    m.setToolSearch(true)
    expect(localStorage.getItem('chat-demo:tools-enabled')).toBe('false')
    expect(localStorage.getItem('chat-demo:tool-read')).toBe('false')
    expect(localStorage.getItem('chat-demo:tool-edit')).toBe('false')
    expect(localStorage.getItem('chat-demo:tool-search')).toBe('true')
    expect(localStorage.getItem('chat-demo:search')).toBe('true')
    // 重新加载后保持
    vi.resetModules()
    const reloaded = await import('./settings.js')
    const state = reloaded.useSettings.getState()
    expect(state.toolsEnabled).toBe(false)
    expect(state.toolRead).toBe(false)
    expect(state.toolEdit).toBe(false)
    expect(state.toolSearch).toBe(true)
  })

  it('写入能力标记并校验读取', async () => {
    const m = await load()
    m.setToolCapabilities({ apiOrigin: 'https://api.deepseek.com', serverWebToolsWithClientTools: false })
    expect(JSON.parse(localStorage.getItem('chat-demo:tool-capabilities') ?? '{}')).toEqual({
      apiOrigin: 'https://api.deepseek.com',
      serverWebToolsWithClientTools: false,
    })
    vi.resetModules()
    const reloaded = await import('./settings.js')
    expect(reloaded.useSettings.getState().toolCapabilities).toEqual({
      apiOrigin: 'https://api.deepseek.com',
      serverWebToolsWithClientTools: false,
    })
  })

  it('setSearch 保持向后兼容，等同 setToolSearch', async () => {
    const m = await load()
    m.setSearch(true)
    expect(m.useSettings.getState().toolSearch).toBe(true)
    expect(m.useSettings.getState().search).toBe(true)
  })
})
