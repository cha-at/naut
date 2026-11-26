import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Session, UserMessage } from '../types.js'
import { toSessionFile } from './toArchive.js'

const user: UserMessage = {
  id: 'u1',
  role: 'user',
  content: '请记住我的偏好',
  files: [],
  createdAt: 1,
}

const reply = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 2,
  model: 'deepseek-flash',
  prefix: false,
  status: 'done',
  blocks: [
    { type: 'thinking', thinking: '内部思考', signature: 'sig' },
    { type: 'tool_use', id: 't1', name: 'edit', input: { file_path: 'MEMORY.md' } },
    { type: 'tool_result', tool_use_id: 't1', content: 'Edited MEMORY.md' },
    { type: 'text', text: '已记住。' },
  ],
  ...overrides,
})

const session = (message: AssistantMessage): Session => ({
  id: 's1',
  title: '偏好',
  createdAt: 1,
  updatedAt: 2,
  rootMessageId: null,
  messages: [user, message],
  personaSnapshot: { id: 'p1', name: '严谨工程师', prompt: '回答简洁' },
  memorySnapshot: { user: '长期记忆内容', memory: 'MEMORY 正文', capturedAt: 3 },
})

describe('历史导出', () => {
  it('不写入人格、记忆快照与客户端工具块', () => {
    const file = toSessionFile(session(reply()), () => null)
    const json = JSON.stringify(file)
    expect(json).not.toContain('长期记忆内容')
    expect(json).not.toContain('MEMORY 正文')
    expect(json).not.toContain('严谨工程师')
    expect(json).not.toContain('Edited MEMORY.md')
    expect(json).not.toContain('tool_result')
    const types = file.messages[1].fragments.map((fragment) => fragment.type)
    expect(types).toEqual(['THINK', 'RESPONSE'])
  })

  it('search_enabled 按实际工具集推导，旧回复沿用 search 字段', () => {
    const withTools = toSessionFile(
      session(reply({ toolset: ['list', 'read', 'edit'] })),
      () => null
    )
    expect(withTools.messages[1].search_enabled).toBe(false)
    const withSearch = toSessionFile(
      session(reply({ toolset: ['list', 'search'] })),
      () => null
    )
    expect(withSearch.messages[1].search_enabled).toBe(true)
    const legacy = toSessionFile(session(reply({ search: true })), () => null)
    expect(legacy.messages[1].search_enabled).toBe(true)
  })
})
