import { describe, expect, it } from 'vitest'
import { BASE_IDENTITY, buildSystemPrompt, buildToolInstructions, TRUNCATION_NOTE } from './prompt.js'
import type { MemorySnapshot } from './memory/types.js'
import type { Toolset } from './tools/schemas.js'

const persona = { id: 'p1', name: '严谨工程师', prompt: '回答简洁，先给结论。' }

const memory = (overrides: Partial<MemorySnapshot> = {}): MemorySnapshot => ({
  user: '偏好深色主题',
  memory: '长期记忆内容',
  capturedAt: 1,
  ...overrides,
})

const prompt = (toolset: Toolset = ['list', 'read', 'edit'], overrides: Partial<MemorySnapshot> = {}) =>
  buildSystemPrompt({ persona, memory: memory(overrides), toolset })

describe('系统提示词结构', () => {
  it('顺序为身份、当前人格、工具说明、USER.md、MEMORY.md', () => {
    const text = prompt()
    const order = [
      BASE_IDENTITY,
      '## 当前人格',
      '## 记忆与工具',
      '## 用户记忆（USER.md）',
      '## 长期记忆（MEMORY.md）',
    ].map((marker) => text.indexOf(marker))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('人格名称与设定都进入提示词', () => {
    const text = prompt()
    expect(text).toContain('严谨工程师')
    expect(text).toContain('回答简洁，先给结论。')
  })

  it('空人格设定仍保留标题与名称', () => {
    const text = buildSystemPrompt({
      persona: { id: 'p1', name: '默认人格', prompt: '' },
      memory: memory(),
      toolset: [],
    })
    expect(text).toContain('## 当前人格\n默认人格\n（未设置人格设定）')
  })

  it('空记忆仍有标题与「（空）」', () => {
    const text = prompt(['list', 'read', 'edit'], { user: '', memory: '' })
    expect(text).toContain('## 用户记忆（USER.md）\n（空）')
    expect(text).toContain('## 长期记忆（MEMORY.md）\n（空）')
  })

  it('截断时追加说明', () => {
    const text = prompt(['list', 'read', 'edit'], { userTruncated: true, memoryTruncated: true })
    expect(text.split(TRUNCATION_NOTE)).toHaveLength(3)
    expect(text).toContain(`偏好深色主题\n\n${TRUNCATION_NOTE}`)
  })

  it('没有工具时不出现工具区块', () => {
    const text = prompt([])
    expect(text).not.toContain('## 记忆与工具')
    expect(text).toContain('## 用户记忆（USER.md）')
  })

  it('工具说明只描述实际声明的工具', () => {
    const readOnly = buildToolInstructions(['list', 'read'])
    expect(readOnly).toContain('list()')
    expect(readOnly).toContain('read(file_path')
    expect(readOnly).not.toContain('edit(file_path')
    expect(readOnly).not.toContain('Smart search')

    const searchOnly = buildToolInstructions(['search'])
    expect(searchOnly).toContain('Smart search')
    expect(searchOnly).not.toContain('read(file_path')

    const editOnly = buildToolInstructions(['edit'])
    expect(editOnly).toContain('edit(file_path')
    expect(editOnly).not.toContain('read(file_path')
    expect(editOnly).not.toContain('list()')
  })

  it('客户端联网模式描述 web_search 与 web_fetch', () => {
    const text = buildSystemPrompt({
      persona,
      memory: memory(),
      toolset: ['list', 'read', 'edit', 'search'],
      searchMode: 'client',
    })
    expect(text).toContain('web_search(query')
    expect(text).toContain('web_fetch(url)')
    expect(text).not.toContain('Smart search')
    // 服务端模式仍使用内置联网说明
    const server = buildSystemPrompt({ persona, memory: memory(), toolset: ['search'] })
    expect(server).toContain('Smart search')
    expect(server).not.toContain('web_search(')
  })

  it('工具说明没有快照与记忆策略时省略对应段落', () => {
    expect(buildToolInstructions([])).toBe('')
    expect(buildToolInstructions(['list'])).not.toContain('snapshots below were captured')
    expect(buildToolInstructions(['edit'])).toContain('Only store durable preferences')
  })

  it('两份记忆内容原样拼接', () => {
    const text = prompt()
    expect(text).toContain('## 用户记忆（USER.md）\n偏好深色主题')
    expect(text).toContain('## 长期记忆（MEMORY.md）\n长期记忆内容')
  })
})
