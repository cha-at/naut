import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import { resetWebMemoryDatabase } from '../memory/web.js'
import { memoryService } from '../memory/index.js'
import { MemoryError } from '../memory/types.js'
import { useSettings } from '../settings.js'
import { useToast } from '../../components/base/toastState.js'
import { setDraftText } from './drafts.js'
import { stopReply, sendMessage, useChatStore } from './store.js'
import type { AssistantMessage, Session } from './types.js'

const mocks = vi.hoisted(() => ({ streamMessage: vi.fn(), requestTitle: vi.fn() }))

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client.js')>()
  return {
    ...actual,
    streamMessage: (...args: unknown[]) => mocks.streamMessage(...args),
  }
})

vi.mock('./title.js', () => ({ requestTitle: mocks.requestTitle }))

const streamOf = (events: unknown[]) =>
  async function* () {
    for (const event of events) {
      yield event
    }
  }

const messageStart = { type: 'message_start', message: { id: 'm1', model: 'deepseek-flash' } }
const messageStop = { type: 'message_stop' }
const endTurn = { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
const toolUseEnd = { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null } }
const refused = {
  type: 'message_delta',
  delta: { stop_reason: 'refusal', stop_sequence: null },
}

const textRound = (text: string) => [
  messageStart,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
]

const toolRound = (index: number, id: string, name: string, input: unknown) => {
  const json = JSON.stringify(input)
  const half = Math.max(1, Math.floor(json.length / 2))
  return [
    messageStart,
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
    {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: json.slice(0, half) },
    },
    {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: json.slice(half) },
    },
    { type: 'content_block_stop', index },
  ]
}

const idle = () =>
  vi.waitFor(
    () => {
      expect(Object.keys(useChatStore.getState().streaming)).toHaveLength(0)
    },
    { timeout: 3000 }
  )

const activeSession = (): Session => {
  const state = useChatStore.getState()
  const session = state.activeId ? state.sessionCache[state.activeId] : undefined
  if (!session) {
    throw new Error('no active session')
  }
  return session
}

const lastReply = (): AssistantMessage => {
  const message = activeSession().messages.at(-1)
  if (message?.role !== 'assistant') {
    throw new Error('no reply')
  }
  return message
}

const requestBody = (call: number): CreateMessageRequest =>
  mocks.streamMessage.mock.calls[call][1] as CreateMessageRequest

beforeEach(async () => {
  await resetWebMemoryDatabase()
  localStorage.clear()
  useChatStore.setState({
    ready: true,
    sessions: [],
    sessionCache: {},
    activeId: null,
    streaming: {},
    importingHistory: false,
    sessionSaveErrors: {},
  })
  useSettings.setState({
    apiKey: 'test-key',
    toolsEnabled: true,
    toolRead: true,
    toolEdit: true,
    toolSearch: false,
    toolCapabilities: {},
    thinking: false,
  })
  setDraftText(null, '请更新记忆')
  mocks.streamMessage.mockReset()
  mocks.requestTitle.mockReset()
  mocks.requestTitle.mockResolvedValue(null)
})

describe('agent loop：工具往返', () => {
  it('tool_use → 执行 → tool_result → 下一轮 → 正文', async () => {
    const edit = { file_path: 'MEMORY.md', old_string: '长期记忆', new_string: '长期记忆（已更新）' }
    mocks.streamMessage
      .mockImplementationOnce(() =>
        streamOf([...textRound('我来更新记忆。'), ...toolRound(1, 'toolu_1', 'edit', edit), toolUseEnd, messageStop])()
      )
      .mockImplementationOnce(() => streamOf([...textRound('已记住。'), endTurn, messageStop])())

    await sendMessage(null)
    await idle()
    const reply = lastReply()
    expect(reply.status).toBe('done')
    expect(reply.stopReason).toBe('end_turn')
    expect(reply.blocks.map((block) => block.type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
      'text',
    ])
    const result = reply.blocks[2]
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    expect(result.type === 'tool_result' && result.isError).toBeFalsy()
    expect(result.type === 'tool_result' && result.content).toContain(
      'Edited MEMORY.md: replaced 1 occurrence'
    )
    expect((await memoryService.readFull('MEMORY.md')).content).toContain('长期记忆（已更新）')
    expect(reply.toolset).toEqual(['list', 'read', 'edit'])

    // 第二轮请求：包含 assistant(tool_use) 与 user(tool_result)
    expect(mocks.streamMessage).toHaveBeenCalledTimes(2)
    const body = requestBody(1)
    expect(body).not.toHaveProperty('safety_check')
    expect(body.system).toContain('## 当前人格')
    expect(body.system).toContain('## 用户记忆（USER.md）')
    expect(body.tools.map((tool) => tool.name)).toEqual(['list', 'read', 'edit'])
    const toolUse = body.messages.find(
      (message) =>
        message.role === 'assistant' &&
        message.content.some((block) => block.type === 'tool_use')
    )
    expect(toolUse).toBeTruthy()
    const toolResult = body.messages.find(
      (message) =>
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'tool_result')
    )
    expect(toolResult).toBeTruthy()
    // 含客户端工具时主请求不带 title，标题请求在完成后单独发出
    expect(requestBody(0)).not.toHaveProperty('title')
    expect(mocks.requestTitle).toHaveBeenCalledWith(
      expect.objectContaining({ question: '请更新记忆' })
    )
  })

  it('快照捕获失败时阻止发送且不创建会话', async () => {
    const spy = vi
      .spyOn(memoryService, 'readSnapshot')
      .mockRejectedValue(new MemoryError('root_unavailable'))
    await sendMessage(null)
    expect(useChatStore.getState().sessions).toHaveLength(0)
    expect(useChatStore.getState().activeId).toBeNull()
    expect(mocks.streamMessage).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('旧会话缺少快照时在发送前补捕获并写入请求', async () => {
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([...textRound('第一次回答'), endTurn, messageStop])()
    )
    await sendMessage(null)
    await idle()
    const sessionId = useChatStore.getState().activeId
    expect(sessionId).toBeTruthy()
    // 模拟旧会话/导入会话：清掉会话上的快照
    useChatStore.setState((state) => {
      const session = state.sessionCache[sessionId ?? '']
      if (!session) {
        return state
      }
      return {
        sessionCache: {
          ...state.sessionCache,
          [session.id]: {
            ...session,
            personaSnapshot: undefined,
            memorySnapshot: undefined,
          },
        },
      }
    })
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([...textRound('第二次回答'), endTurn, messageStop])()
    )
    setDraftText(sessionId, '再试一次')
    await sendMessage(sessionId)
    await idle()
    const body = requestBody(1)
    expect(body.system).toContain('## 当前人格')
    expect(body.system).toContain('## 用户记忆（USER.md）')
    expect(useChatStore.getState().sessionCache[sessionId ?? '']?.personaSnapshot).toBeTruthy()
  })

  it('多轮请求的用量累加', async () => {
    const usage = (input: number, cacheRead: number, output: number) => ({
      input_tokens: input,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cacheRead,
      output_tokens: output,
    })
    mocks.streamMessage
      .mockImplementationOnce(() =>
        streamOf([
          ...toolRound(0, 'toolu_1', 'list', {}),
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: usage(100, 10, 20),
          },
          messageStop,
        ])()
      )
      .mockImplementationOnce(() =>
        streamOf([
          ...textRound('好的'),
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: usage(150, 40, 5),
          },
          messageStop,
        ])()
      )
    await sendMessage(null)
    await idle()
    expect(lastReply().usage).toEqual({
      input_tokens: 250,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 50,
      output_tokens: 25,
    })
  })

  it('内置联网不兼容时改用独立搜索接口重试并记录标记', async () => {
    useSettings.setState({ toolSearch: true })
    mocks.streamMessage
      .mockImplementationOnce(() => {
        throw new ApiError(
          'http',
          'other tools cannot be used together with deepseek_web_search',
          400
        )
      })
      .mockImplementationOnce(() => streamOf([...textRound('好的。'), endTurn, messageStop])())

    await sendMessage(null)
    await idle()
    const reply = lastReply()
    expect(reply.status).toBe('done')
    expect(mocks.streamMessage).toHaveBeenCalledTimes(2)
    const first = requestBody(0)
    expect(first.tools.map((tool) => tool.name)).toEqual([
      'list',
      'read',
      'edit',
      'deepseek_web_search',
      'deepseek_read_url',
    ])
    // 重试仍保留联网能力，但改为声明独立的 web_search / web_fetch 客户端工具
    const retry = requestBody(1)
    expect(retry.tools.map((tool) => tool.name)).toEqual([
      'list',
      'read',
      'edit',
      'web_search',
      'web_fetch',
    ])
    expect(retry.system).toContain('web_search(')
    expect(reply.toolset).toEqual(['list', 'read', 'edit', 'search'])
    expect(reply.search).toBe(true)
    expect(useToast.getState().message).toMatchObject({ key: 'toolSearchDegraded' })
    expect(useSettings.getState().toolCapabilities).toMatchObject({
      serverWebToolsWithClientTools: false,
      apiOrigin: 'https://api.deepseek.com',
    })

    // 之后的请求直接使用独立接口，不再触发 400
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([...textRound('第二次回答'), endTurn, messageStop])()
    )
    setDraftText(null, '再问一次')
    await sendMessage(null)
    await idle()
    expect(mocks.streamMessage).toHaveBeenCalledTimes(3)
    expect(requestBody(2).tools.map((tool) => tool.name)).toEqual([
      'list',
      'read',
      'edit',
      'web_search',
      'web_fetch',
    ])
  })

  it('只声明联网工具时保留内联标题', async () => {
    useSettings.setState({ toolRead: false, toolEdit: false, toolSearch: true })
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([
        ...textRound('答案'),
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null, title: '关于记忆的问题' },
        },
        messageStop,
      ])()
    )
    await sendMessage(null)
    await idle()
    expect(requestBody(0).title).toEqual({ enabled: true })
    const session = activeSession()
    expect(session.title).toBe('关于记忆的问题')
    expect(mocks.requestTitle).not.toHaveBeenCalled()
  })

  it('达到 12 轮工具执行后以错误收尾', async () => {
    let counter = 0
    mocks.streamMessage.mockImplementation(() => {
      counter += 1
      return streamOf([
        ...toolRound(0, `toolu_${counter}`, 'list', {}),
        toolUseEnd,
        messageStop,
      ])()
    })
    await sendMessage(null)
    await idle()
    const reply = lastReply()
    expect(reply.status).toBe('error')
    expect(reply.error?.kind).toBe('tools')
    expect(reply.error?.localMessage).toEqual({ key: 'toolCallRoundLimit' })
    // 12 次执行 + 第 13 轮请求发现超限
    expect(mocks.streamMessage).toHaveBeenCalledTimes(13)
    const executions = reply.blocks.filter((block) => block.type === 'tool_result')
    expect(executions).toHaveLength(12)
  })

  it('连续三次存储错误提前收尾', async () => {
    vi.spyOn(memoryService, 'edit').mockRejectedValue(new MemoryError('io'))
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([
        ...toolRound(0, 'toolu_1', 'edit', { file_path: 'MEMORY.md', old_string: 'a', new_string: 'b' }),
        ...toolRound(1, 'toolu_2', 'edit', { file_path: 'MEMORY.md', old_string: 'a', new_string: 'b' }),
        ...toolRound(2, 'toolu_3', 'edit', { file_path: 'MEMORY.md', old_string: 'a', new_string: 'b' }),
        toolUseEnd,
        messageStop,
      ])()
    )
    await sendMessage(null)
    await idle()
    const reply = lastReply()
    expect(reply.status).toBe('error')
    expect(reply.error?.kind).toBe('storage')
    expect(reply.error?.localMessage).toEqual({ key: 'toolCallStorageFailed' })
    expect(mocks.streamMessage).toHaveBeenCalledTimes(1)
    expect(reply.blocks.filter((block) => block.type === 'tool_result')).toHaveLength(3)
  })

  it('停止生成：已收到内容保留并标记 stopped，不再请求下一轮', async () => {
    mocks.streamMessage.mockImplementationOnce(
      // 收到一段正文后挂起，直到停止信号中止请求
      async function* (_apiKey: string, _body: unknown, signal: AbortSignal) {
        yield messageStart
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '半截回答' } }
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          })
        })
      }
    )
    await sendMessage(null)
    await vi.waitFor(() => {
      expect(lastReply().blocks.length).toBeGreaterThan(0)
    })
    stopReply(useChatStore.getState().activeId ?? '')
    await idle()
    const reply = lastReply()
    expect(reply.status).toBe('stopped')
    expect(reply.blocks.some((block) => block.type === 'text' && block.text.includes('半截回答'))).toBe(
      true
    )
    expect(mocks.streamMessage).toHaveBeenCalledTimes(1)
  })

  it('拒答时清空思考与正文，只保留模板', async () => {
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([
        messageStart,
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '不能回答' } },
        { type: 'content_block_stop', index: 0 },
        ...textRound('不该出现的草稿').slice(1),
        refused,
        messageStop,
      ])()
    )
    await sendMessage(null)
    await idle()
    const reply = lastReply()
    expect(reply.stopReason).toBe('refusal')
    expect(reply.status).toBe('done')
    expect(reply.blocks.filter((block) => block.type === 'text' || block.type === 'thinking')).toHaveLength(0)
    expect(mocks.requestTitle).not.toHaveBeenCalled()
  })
})
