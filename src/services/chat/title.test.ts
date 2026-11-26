import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ streamMessage: vi.fn() }))

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client.js')>()
  return { ...actual, streamMessage: (...args: unknown[]) => mocks.streamMessage(...args) }
})

import { requestTitle } from './title.js'

const streamOf = (events: unknown[]) =>
  async function* () {
    for (const event of events) {
      yield event
    }
  }

const signal = () => new AbortController().signal

beforeEach(() => {
  mocks.streamMessage.mockReset()
})

describe('独立标题请求', () => {
  it('不带工具、不带 safety_check，只用首条用户消息', async () => {
    mocks.streamMessage.mockImplementationOnce(() =>
      streamOf([
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null, title: '  关于记忆的问题  ' },
        },
      ])()
    )
    const title = await requestTitle({
      apiKey: 'key',
      model: 'deepseek-flash',
      question: '请记住我的偏好',
      signal: signal(),
    })
    expect(title).toBe('关于记忆的问题')
    const body = mocks.streamMessage.mock.calls[0][1] as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      tools: [],
      title: { enabled: true },
      messages: [{ role: 'user', content: '请记住我的偏好' }],
    })
    expect(body).not.toHaveProperty('safety_check')
    expect(body.system).toBe('该助手为DeepSeek，由深度求索公司创造。')
  })

  it('空问题时直接返回 null，不发请求', async () => {
    const title = await requestTitle({
      apiKey: 'key',
      model: 'deepseek-flash',
      question: '   ',
      signal: signal(),
    })
    expect(title).toBeNull()
    expect(mocks.streamMessage).not.toHaveBeenCalled()
  })

  it('没有标题或请求失败时静默返回 null', async () => {
    mocks.streamMessage.mockImplementationOnce(() => streamOf([{ type: 'message_stop' }])())
    expect(
      await requestTitle({ apiKey: 'key', model: 'deepseek-flash', question: 'q', signal: signal() })
    ).toBeNull()

    mocks.streamMessage.mockImplementationOnce(() => {
      throw new Error('network down')
    })
    expect(
      await requestTitle({ apiKey: 'key', model: 'deepseek-flash', question: 'q', signal: signal() })
    ).toBeNull()
  })
})
