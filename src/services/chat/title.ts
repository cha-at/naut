import { streamMessage } from '../api/client.js'
import type { ChatModel } from '../api/types.js'
import { BASE_IDENTITY } from '../prompt.js'

/**
 * 含客户端工具的回复不在主请求里带 title，完成后单独发一次不带工具的标题请求。
 * 只用首条用户消息，失败静默（不输出任何记忆正文）。
 */
export const requestTitle = async ({
  apiKey,
  model,
  question,
  signal,
}: {
  apiKey: string
  model: ChatModel
  question: string
  signal: AbortSignal
}): Promise<string | null> => {
  if (!question.trim()) {
    return null
  }
  try {
    const events = streamMessage(
      apiKey,
      {
        model,
        system: BASE_IDENTITY,
        messages: [{ role: 'user', content: question }],
        thinking: { type: 'disabled' },
        tools: [],
        title: { enabled: true },
      },
      signal
    )
    for await (const event of events) {
      if (event.type === 'message_delta' && event.delta.title?.trim()) {
        return event.delta.title.trim()
      }
    }
  } catch {
    // 标题请求失败不影响回复状态，也不重试
  }
  return null
}
