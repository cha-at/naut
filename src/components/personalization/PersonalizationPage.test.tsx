import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../services/settings.js'
import { resetWebMemoryDatabase } from '../../services/memory/web.js'
import { PersonalizationPage } from './PersonalizationPage.js'
import { openPersonalization, usePersonalization } from './personalizationState.js'
import { useSettingsDialog } from '../settings/settingsDialogState.js'

beforeEach(async () => {
  localStorage.clear()
  setLocale('zh-CN')
  useSettingsDialog.setState({ open: false, section: 'general' })
  usePersonalization.setState({ open: false, view: { kind: 'main' }, returnSection: 'general' })
  await resetWebMemoryDatabase()
})

afterEach(() => {
  cleanup()
})

describe('个性化页面', () => {
  it('从设置入口打开后渲染四个分区', async () => {
    openPersonalization('general')
    render(<PersonalizationPage />)
    expect(await screen.findByRole('heading', { name: '个性化' })).toBeTruthy()
    for (const section of ['人格', '工具', '记忆', '备份']) {
      expect(screen.getAllByText(section).length).toBeGreaterThan(0)
    }
  })

  it('返回后重新打开设置页并保留分组', async () => {
    openPersonalization('data')
    const user = userEvent.setup()
    render(<PersonalizationPage />)
    await user.click(screen.getByRole('button', { name: '返回' }))
    expect(usePersonalization.getState().open).toBe(false)
    expect(useSettingsDialog.getState()).toMatchObject({ open: true, section: 'data' })
  })

  it('单项开关切换后写入设置', async () => {
    openPersonalization('general')
    const user = userEvent.setup()
    render(<PersonalizationPage />)
    const readSwitch = await screen.findByRole('switch', { name: /读取记忆/ })
    expect(readSwitch.getAttribute('aria-checked')).toBe('true')
    await user.click(readSwitch)
    await waitFor(() => expect(localStorage.getItem('chat-demo:tool-read')).toBe('false'))
    expect(usePersonalization.getState().open).toBe(true)
  })

  it('Web 端记忆区只显示两份固定文档，没有新建入口', async () => {
    openPersonalization('general')
    render(<PersonalizationPage />)
    const memorySection = await screen.findByRole('region', { name: '记忆' })
    await waitFor(() => expect(within(memorySection).getByText('USER.md')).toBeTruthy())
    expect(within(memorySection).getByText('MEMORY.md')).toBeTruthy()
    expect(within(memorySection).queryByText('新建文件')).toBeNull()
    expect(within(memorySection).getByText('浏览器本地存储')).toBeTruthy()
  })
})

describe('人格编辑器', () => {
  it('新建人格：空名称被拒绝，填写后保存回到列表', async () => {
    openPersonalization('general')
    const user = userEvent.setup()
    render(<PersonalizationPage />)
    await user.click(await screen.findByRole('button', { name: /新建人格/ }))
    expect(await screen.findByRole('heading', { name: '新建人格' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请输入人格名称')).toBeTruthy()
    await user.type(screen.getByPlaceholderText('名称'), '严谨工程师')
    await user.type(screen.getByPlaceholderText(/描述你希望助手/), '回答简洁，先给结论。')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(usePersonalization.getState().view.kind).toBe('main'))
    expect(await screen.findByText('严谨工程师')).toBeTruthy()
  })

  it('未保存时返回弹出确认，取消后留在编辑器', async () => {
    openPersonalization('general')
    const user = userEvent.setup()
    render(<PersonalizationPage />)
    await user.click(await screen.findByRole('button', { name: /新建人格/ }))
    await user.type(screen.getByPlaceholderText('名称'), '临时人格')
    await user.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText('放弃未保存的修改？')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(usePersonalization.getState().view.kind).toBe('persona')
  })
})
