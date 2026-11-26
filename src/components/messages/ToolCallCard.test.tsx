import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryService } from '../../services/memory/index.js'
import { resetWebMemoryDatabase } from '../../services/memory/web.js'
import { setLocale } from '../../services/settings.js'
import {
  buildReplyView,
  type EditStep,
  type ListStep,
  type ReadStep,
  type ToolErrorStep,
  type WebFetchStep,
  type WebSearchStep,
} from '../../services/chat/view.js'
import type { AssistantMessage, ReplyBlock } from '../../services/chat/types.js'
import { ToolCallCard } from './ToolCallCard.js'

type ToolStep =
  | ListStep
  | ReadStep
  | EditStep
  | WebSearchStep
  | WebFetchStep
  | ToolErrorStep

/** 取视图里的第一个工具步骤；组件只接受工具步骤 */
const toolStep = (reply: AssistantMessage, streaming = false): ToolStep => {
  const step = buildReplyView(reply, streaming).steps[0]
  if (
    step.type !== 'list' &&
    step.type !== 'read' &&
    step.type !== 'edit' &&
    step.type !== 'web_search' &&
    step.type !== 'web_fetch' &&
    step.type !== 'tool_error'
  ) {
    throw new Error(`expected a tool step, got ${step.type}`)
  }
  return step
}

const assistant = (blocks: ReplyBlock[]): AssistantMessage => ({
  id: 'r1',
  role: 'assistant',
  createdAt: 0,
  model: 'deepseek-flash',
  prefix: false,
  status: 'done',
  blocks,
})

beforeEach(async () => {
  await resetWebMemoryDatabase()
  setLocale('zh-CN')
})

describe('工具卡片', () => {
  it('list 成功卡片显示数量，展开后显示条目', async () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'list', input: {} },
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'Memory directory: 1 file',
        display: {
          entries: [{ name: 'USER.md', size: 1200, modifiedAt: 0, isMemory: true }],
          truncated: false,
        },
      },
    ])
    const step = toolStep(reply)
    expect(step.type).toBe('list')
    render(<ToolCallCard step={step} message={reply} />)
    expect(screen.getByText('查看 1 个文件')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('USER.md')).toBeTruthy()
    expect(screen.getByText('快照')).toBeTruthy()
  })

  it('read 卡片展开后显示带行号的预览', async () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'read', input: { file_path: 'USER.md' } },
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: '5: a\n6: b',
        display: { file: 'USER.md', startLine: 5, totalLines: 10, preview: 'a\nb' },
      },
    ])
    const step = toolStep(reply)
    render(<ToolCallCard step={step} message={reply} />)
    expect(screen.getByText('读取 USER.md')).toBeTruthy()
    expect(screen.getByText('共 10 行')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText(/5: a/)).toBeTruthy()
    expect(document.querySelector('pre')?.textContent).toBe('5: a\n6: b')
  })

  it('失败的卡片显示红色摘要，展开后显示原始错误', async () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'read', input: { file_path: '../secret.md' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'Error: invalid path', isError: true },
    ])
    const step = toolStep(reply)
    render(<ToolCallCard step={step} message={reply} />)
    expect(screen.getByText('工具执行失败')).toBeTruthy()
    expect(screen.getByText('invalid path')).toBeTruthy()
  })

  it('进行中的卡片显示进行态且不可展开', () => {
    const reply = assistant([{ type: 'tool_use', id: 't1', name: 'list', input: {} }])
    const step = toolStep(reply, true)
    render(<ToolCallCard step={step} message={reply} />)
    expect(screen.getByText('查看记忆目录')).toBeTruthy()
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('编辑后可以撤销，卡片显示已撤销并恢复文件', async () => {
    await memoryService.write('MEMORY.md', '旧内容')
    const outcome = await memoryService.edit('MEMORY.md', '旧内容', '新内容', false, 't1')
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'edit', input: { file_path: 'MEMORY.md' } },
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'Edited MEMORY.md: replaced 1 occurrence',
        display: {
          file: 'MEMORY.md',
          replacements: 1,
          backupId: outcome.backupId,
          oldString: '旧内容',
          newString: '新内容',
        },
      },
    ])
    const step = toolStep(reply)
    expect(step.type).toBe('edit')
    render(<ToolCallCard step={step as EditStep} message={reply} />)
    const user = userEvent.setup()
    const undo = await screen.findByRole('button', { name: '撤销' })
    await user.click(undo)
    await waitFor(() => expect(screen.getByText('已撤销')).toBeTruthy())
    expect((await memoryService.readFull('MEMORY.md')).content).toBe('旧内容')
  })

  it('web_search 卡片显示结果数量，展开后显示链接', async () => {
    const reply = assistant([
      { type: 'tool_use', id: 'w1', name: 'web_search', input: { query: 'deepseek v4' } },
      {
        type: 'tool_result',
        tool_use_id: 'w1',
        content: 'Web search results',
        display: {
          query: 'deepseek v4',
          results: [
            { title: 'DeepSeek V4', url: 'https://example.com/v4', date: '2026-06-01' },
            { title: '另一篇', url: 'https://example.com/b', date: null },
          ],
          truncated: false,
        },
      },
    ])
    const step = toolStep(reply)
    expect(step.type).toBe('web_search')
    render(<ToolCallCard step={step} message={reply} />)
    expect(screen.getByText('联网搜索')).toBeTruthy()
    expect(screen.getByText('2 个结果')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('link', { name: 'DeepSeek V4' }).getAttribute('href')).toBe(
      'https://example.com/v4'
    )
    expect(screen.getByText(/搜索词：deepseek v4/)).toBeTruthy()
  })

  it('web_fetch 卡片显示网页标题与正文预览', async () => {
    const reply = assistant([
      { type: 'tool_use', id: 'f1', name: 'web_fetch', input: { url: 'https://example.com/a' } },
      {
        type: 'tool_result',
        tool_use_id: 'f1',
        content: 'page',
        display: {
          url: 'https://example.com/a',
          title: '页面标题',
          preview: '# 正文\n\n更多内容',
          truncated: true,
        },
      },
    ])
    const step = toolStep(reply)
    expect(step.type).toBe('web_fetch')
    render(<ToolCallCard step={step} message={reply} />)
    expect(screen.getByText('读取网页')).toBeTruthy()
    expect(screen.getByText('页面标题')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('https://example.com/a')).toBeTruthy()
    expect(document.querySelector('pre')?.textContent).toBe('# 正文\n\n更多内容')
    expect(screen.getByText('内容已截断')).toBeTruthy()
  })

  it('多种工具按到达顺序进入时间线', () => {
    const reply = assistant([
      { type: 'tool_use', id: 't1', name: 'list', input: {} },
      { type: 'tool_result', tool_use_id: 't1', content: 'Memory directory: 2 files', display: { entries: [] } },
      { type: 'tool_use', id: 't2', name: 'read', input: { file_path: 'USER.md' } },
      { type: 'tool_result', tool_use_id: 't2', content: '1: a', display: { file: 'USER.md', preview: 'a', startLine: 1, totalLines: 1 } },
      { type: 'tool_use', id: 't3', name: 'edit', input: { file_path: 'MEMORY.md' } },
    ])
    const steps = buildReplyView(reply, true).steps
    expect(steps.map((step) => step.type)).toEqual(['list', 'read', 'edit'])
    expect(steps[2]).toMatchObject({ type: 'edit', status: 'wip', file: 'MEMORY.md' })
  })
})
