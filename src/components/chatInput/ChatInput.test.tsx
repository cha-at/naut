import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { setLocale, useSettings } from '../../services/settings.js'
import { ChatInput } from './ChatInput.js'

beforeEach(() => {
  localStorage.clear()
  setLocale('zh-CN')
  useSettings.setState({
    toolsEnabled: true,
    thinking: false,
    toolRead: true,
    toolEdit: true,
    toolSearch: true,
    toolCapabilities: {},
  })
})

describe('输入栏工具总开关', () => {
  it('原智能搜索按钮原位改为工具调用，数量不变', async () => {
    render(<ChatInput sessionId={null} />)
    expect(screen.queryByRole('button', { name: '智能搜索' })).toBeNull()
    const tools = screen.getByRole('button', { name: '工具调用' })
    const thinking = screen.getByRole('button', { name: '深度思考' })
    expect(tools).toBeTruthy()
    expect(thinking).toBeTruthy()
  })

  it('点击切换并持久化 toolsEnabled', async () => {
    render(<ChatInput sessionId={null} />)
    const user = userEvent.setup()
    const tools = screen.getByRole('button', { name: '工具调用' })
    expect(tools.getAttribute('aria-pressed')).toBe('true')
    await user.click(tools)
    expect(tools.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('chat-demo:tools-enabled')).toBe('false')
    await user.click(tools)
    expect(localStorage.getItem('chat-demo:tools-enabled')).toBe('true')
  })

})
