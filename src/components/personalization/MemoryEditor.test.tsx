import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryService } from '../../services/memory/index.js'
import { resetWebMemoryDatabase } from '../../services/memory/web.js'
import {
  setLocale,
  setToolCapabilities,
  setToolEdit,
  setToolRead,
  setToolSearch,
  useSettings,
} from '../../services/settings.js'
import { PersonalizationPage } from './PersonalizationPage.js'
import { openPersonalization, usePersonalization } from './personalizationState.js'

const openEditor = async (name = 'USER.md') => {
  openPersonalization('general')
  usePersonalization.setState({ view: { kind: 'memory', name } })
  render(<PersonalizationPage />)
  await screen.findByRole('heading', { name })
}

beforeEach(async () => {
  localStorage.clear()
  setLocale('zh-CN')
  await resetWebMemoryDatabase()
})

describe('记忆编辑器', () => {
  it('加载全文、修改后保存并刷新修改时间', async () => {
    await memoryService.write('USER.md', '第一行\n第二行')
    await openEditor()
    const textarea = (await screen.findByRole('textbox', { name: 'USER.md' })) as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toBe('第一行\n第二行'))
    const user = userEvent.setup()
    await user.clear(textarea)
    await user.type(textarea, '新的偏好')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(async () =>
      expect((await memoryService.readFull('USER.md')).content).toBe('新的偏好')
    )
  })

  it('超过 64 KiB 时禁止保存并提示', async () => {
    await openEditor()
    const textarea = await screen.findByRole('textbox', { name: 'USER.md' })
    fireEvent.change(textarea, { target: { value: 'x'.repeat(64 * 1024 + 1) } })
    expect(await screen.findByText(/文件超过 64 KiB/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
  })

  it('未保存时返回弹出确认，放弃后回到主页面', async () => {
    await openEditor()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'USER.md' }), '未保存')
    await user.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText('放弃未保存的修改？')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '放弃' }))
    await waitFor(() => expect(usePersonalization.getState().view.kind).toBe('main'))
  })

  it('外部修改后保存触发冲突，重新加载显示外部内容', async () => {
    await memoryService.write('USER.md', 'v1')
    await openEditor()
    const user = userEvent.setup()
    const textarea = (await screen.findByRole('textbox', { name: 'USER.md' })) as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, '应用内修改')
    // 模拟应用外修改
    await memoryService.write('USER.md', '外部修改')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('文件已在应用外修改')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'USER.md' }) as HTMLTextAreaElement).value).toBe(
        '外部修改'
      )
    )
    expect((await memoryService.readFull('USER.md')).content).toBe('外部修改')
  })

  it('冲突时选择覆盖保存会写入当前编辑内容', async () => {
    await memoryService.write('USER.md', 'v1')
    await openEditor()
    const user = userEvent.setup()
    const textarea = (await screen.findByRole('textbox', { name: 'USER.md' })) as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, '覆盖内容')
    await memoryService.write('USER.md', '外部修改')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('文件已在应用外修改')
    await user.click(screen.getByRole('button', { name: '覆盖保存' }))
    await waitFor(async () =>
      expect((await memoryService.readFull('USER.md')).content).toBe('覆盖内容')
    )
  })

  it('Web 端显示浏览器本地存储并可以下载', async () => {
    await openEditor()
    expect(await screen.findByText('浏览器本地存储')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载记忆文件' })).toBeTruthy()
  })
})

describe('工具区的兼容性说明', () => {
  it('内置联网不可用时提示改用独立接口，搜索仍可开启，并可重新检测', async () => {
    setToolCapabilities({
      apiOrigin: 'https://api.deepseek.com',
      serverWebToolsWithClientTools: false,
    })
    setToolRead(true)
    setToolEdit(true)
    setToolSearch(true)
    openPersonalization('general')
    const user = userEvent.setup()
    render(<PersonalizationPage />)
    const searchSwitch = await screen.findByRole('switch', { name: /智能搜索/ })
    // 联网搜索仍然可用，只是改用独立接口
    expect(searchSwitch.hasAttribute('disabled')).toBe(false)
    expect(searchSwitch.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/独立的搜索与抓取接口/)).toBeTruthy()

    // 重新检测：清掉能力标记，下次请求重新尝试内置联网
    await user.click(screen.getByRole('button', { name: '重新检测内置联网' }))
    expect(useSettings.getState().toolCapabilities).toEqual({})
  })
})
