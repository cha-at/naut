import { describe, expect, it } from 'vitest'
import type { MessageParam } from '../api/types.js'
import {
  buildReplyMessages,
  canContinueReply,
  toRequestMessages,
} from './reply.js'
import type { AssistantMessage, ReplyBlock, UserMessage } from './types.js'

const assistant = (blocks: ReplyBlock[], overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'r1',
  role: 'assistant',
  createdAt: 1,
  model: 'deepseek-flash',
  prefix: true,
  status: 'done',
  blocks,
  ...overrides,
})

const user = (content = 'hi', id = 'u1'): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 0,
})

const roles = (messages: MessageParam[]) => messages.map((message) => message.role)

describe('buildReplyMessages：客户端工具往返', () => {
  it('文本、工具调用、结果与后续正文拆成多条消息', () => {
    const reply = assistant([
      { type: 'text', text: '先看看' },
      { type: 'tool_use', id: 't1', name: 'read', input: { file_path: 'USER.md' } },
      { type: 'tool_result', tool_use_id: 't1', content: '1: a' },
      { type: 'text', text: '好了' },
    ])
    expect(buildReplyMessages(reply, { includeThinking: true, live: true })).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '先看看' },
          { type: 'tool_use', id: 't1', name: 'read', input: { file_path: 'USER.md' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '1: a' }] },
      { role: 'assistant', content: [{ type: 'text', text: '好了' }] },
    ])
  })

  it('同轮多个调用放进同一条 assistant，结果按顺序放进同一条 user', () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'list', input: {} },
      { type: 'tool_use', id: 't2', name: 'read', input: { file_path: 'USER.md' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'list ok' },
      { type: 'tool_result', tool_use_id: 't2', content: 'read ok', isError: true },
    ])
    const messages = buildReplyMessages(reply, { includeThinking: true, live: true })
    expect(roles(messages)).toEqual(['assistant', 'user'])
    expect(messages[0]).toMatchObject({
      content: [
        { type: 'tool_use', id: 't1' },
        { type: 'tool_use', id: 't2' },
      ],
    })
    expect(messages[1]).toMatchObject({
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'list ok' },
        { type: 'tool_result', tool_use_id: 't2', content: 'read ok', is_error: true },
      ],
    })
  })

  it('孤立的 tool_use 与 tool_result 都被丢弃', () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'list', input: {} },
      { type: 'text', text: '正文' },
      { type: 'tool_result', tool_use_id: 't2', content: '孤立结果' },
    ])
    const messages = buildReplyMessages(reply, { includeThinking: true, live: true })
    expect(messages).toEqual([{ role: 'assistant', content: [{ type: 'text', text: '正文' }] }])
  })

  it('结果消息只含 tool_result 块，位于 assistant 之后', () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'edit', input: {} },
      { type: 'tool_result', tool_use_id: 't1', content: 'Edited' },
    ])
    const messages = buildReplyMessages(reply, { includeThinking: true, live: true })
    expect(roles(messages)).toEqual(['assistant', 'user'])
    expect(messages[1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Edited' }],
    })
  })
})

describe('buildReplyMessages：思考与服务端工具', () => {
  it('历史不回传思考，实时保留', () => {
    const reply = assistant([
      { type: 'thinking', thinking: '思考中', signature: 'sig' },
      { type: 'text', text: '回答' },
    ])
    expect(buildReplyMessages(reply)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
    ])
    expect(buildReplyMessages(reply, { includeThinking: true, live: true })).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '思考中', signature: 'sig' },
          { type: 'text', text: '回答' },
        ],
      },
    ])
  })

  it('省略思考后保留前后正文的空行', () => {
    const reply = assistant([
      { type: 'text', text: '第一段' },
      { type: 'thinking', thinking: '想法', signature: 'sig' },
      { type: 'text', text: '第二段' },
    ])
    const messages = buildReplyMessages(reply)
    expect(messages[0]).toMatchObject({
      content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '\n\n第二段' }],
    })
  })

  it('历史只保留 read_link 服务端工具，搜索过程不回传', () => {
    const reply = assistant([
      {
        type: 'server_tool_use',
        id: 's1',
        name: 'deepseek_web_search',
        input: { action: 'search', queries: ['q'] },
        caller: { type: 'direct' },
        kind: 'search',
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [],
        kind: 'search',
      },
      { type: 'text', text: '答案' },
    ])
    expect(buildReplyMessages(reply)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '答案' }] },
    ])
  })
})

describe('toRequestMessages：历史与本轮提问', () => {
  it('按顺序插入 latest_reminder、历史轮次与本轮提问，且不重复提醒', () => {
    const history = [user('q1', 'u1'), assistant([{ type: 'text', text: 'a1' }], { latestReminder: 'REM' })]
    const messages = toRequestMessages(history, user('q2', 'u2'), undefined, false, 'REM')
    expect(roles(messages)).toEqual(['latest_reminder', 'user', 'assistant', 'user'])
    expect(messages[0]).toEqual({ role: 'latest_reminder', content: 'REM' })
    expect(messages[3]).toEqual({ role: 'user', content: 'q2' })
  })

  it('历史中含工具往返的回复展开成多条消息', () => {
    const history = [
      user('q1', 'u1'),
      assistant([
        { type: 'tool_use', id: 't1', name: 'read', input: { file_path: 'USER.md' } },
        { type: 'tool_result', tool_use_id: 't1', content: '1: a' },
        { type: 'text', text: 'a1' },
      ]),
    ]
    const messages = toRequestMessages(history, user('q2', 'u2'))
    expect(roles(messages)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
  })

  it('失败的轮次与没有回答的轮次不进入上下文', () => {
    const history = [
      user('q1', 'u1'),
      assistant([], { status: 'error' }),
      user('q2', 'u2'),
      assistant([{ type: 'text', text: 'a2' }]),
    ]
    const messages = toRequestMessages(history, user('q3', 'u3'))
    expect(roles(messages)).toEqual(['user', 'assistant', 'user'])
    expect(messages[2]).toEqual({ role: 'user', content: 'q3' })
  })
})

describe('canContinueReply', () => {
  it('含客户端工具块的回复不能续写', () => {
    const stopped = assistant([{ type: 'text', text: 'a' }], { status: 'stopped' })
    expect(canContinueReply(stopped)).toBe(true)
    const withTool = assistant(
      [
        { type: 'text', text: 'a' },
        { type: 'tool_use', id: 't1', name: 'list', input: {} },
      ],
      { status: 'stopped' }
    )
    expect(canContinueReply(withTool)).toBe(false)
  })
})
