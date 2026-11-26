import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  isNative: () => true,
  kind: 'native' as const,
  ensureTemplates: vi.fn(async () => undefined),
  paths: vi.fn(async () => ({
    root: 'C:\\Users\\me\\.naut',
    platform: 'windows',
    files: [],
  })),
  list: vi.fn(async () => ({
    entries: [
      { name: 'USER.md', size: 1200, modifiedAt: 1, isMemory: true },
      { name: 'MEMORY.md', size: 2400, modifiedAt: 2, isMemory: true },
      { name: 'notes.md', size: 300, modifiedAt: 3, isMemory: false },
    ],
    truncated: false,
  })),
  create: vi.fn(async (name: string) => ({ name, size: 0, modifiedAt: 4, isMemory: false })),
  rename: vi.fn(async (_oldName: string, newName: string) => ({
    name: newName,
    size: 300,
    modifiedAt: 4,
    isMemory: false,
  })),
  remove: vi.fn(async () => undefined),
  backupState: vi.fn<
    () => Promise<{ available: boolean; backupId?: string; editedAt?: number; editedHash?: string }>
  >(async () => ({ available: false })),
  undo: vi.fn(async () => ({
    name: 'USER.md',
    content: '恢复内容',
    size: 20,
    modifiedAt: 5,
    isMemory: true,
    hash: 'h',
  })),
  read: vi.fn(),
  readFull: vi.fn(),
  write: vi.fn(),
  edit: vi.fn(),
  readSnapshot: vi.fn(),
}))

vi.mock('../../services/memory/index.js', () => ({ memoryService: service }))

import { MemoryFileList } from './MemoryFileList.js'
import { useMemoryUndo } from '../../services/memory/memoryUndoState.js'
import { setLocale } from '../../services/settings.js'
import { usePersonalization } from './personalizationState.js'

beforeEach(() => {
  setLocale('zh-CN')
  vi.clearAllMocks()
  useMemoryUndo.setState({ entries: {} })
  usePersonalization.setState({ open: true, view: { kind: 'main' }, returnSection: 'general' })
})

describe('原生记忆文件列表', () => {
  it('显示目录路径、三份文件与新建入口', async () => {
    render(<MemoryFileList />)
    expect(await screen.findByText('USER.md')).toBeTruthy()
    expect(screen.getByText('MEMORY.md')).toBeTruthy()
    expect(screen.getByText('notes.md')).toBeTruthy()
    expect(screen.getByText(/C:\\Users\\me\\.naut/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建文件' })).toBeTruthy()
    // 记忆文件带快照徽标，额外文件带重命名/删除
    expect(screen.getAllByText('快照')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '重命名' })).toHaveLength(1)
  })

  it('新建文件自动补 .md 并打开编辑器', async () => {
    const user = userEvent.setup()
    render(<MemoryFileList />)
    await user.click(await screen.findByRole('button', { name: '新建文件' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('文件名'), 'ideas')
    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    await waitFor(() => expect(service.create).toHaveBeenCalledWith('ideas.md'))
    await waitFor(() => expect(usePersonalization.getState().view).toEqual({ kind: 'memory', name: 'ideas.md' }))
  })

  it('重命名额外文件', async () => {
    const user = userEvent.setup()
    render(<MemoryFileList />)
    await user.click((await screen.findAllByRole('button', { name: '重命名' }))[0])
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText('文件名')
    await user.clear(input)
    await user.type(input, 'archive.md')
    await user.click(within(dialog).getByRole('button', { name: '确定' }))
    await waitFor(() => expect(service.rename).toHaveBeenCalledWith('notes.md', 'archive.md'))
  })

  it('删除额外文件需要确认', async () => {
    const user = userEvent.setup()
    render(<MemoryFileList />)
    await user.click((await screen.findAllByRole('button', { name: '删除' }))[0])
    expect(await screen.findByText('删除后文件将从记忆目录移除，无法恢复。')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(service.remove).toHaveBeenCalledWith('notes.md'))
  })

  it('有备份时显示撤销入口，撤销后刷新列表', async () => {
    service.backupState.mockResolvedValue({
      available: true,
      backupId: 'b1',
      editedAt: 1,
      editedHash: 'h',
    })
    const user = userEvent.setup()
    render(<MemoryFileList />)
    const undoButtons = await screen.findAllByRole('button', { name: '撤销上次模型编辑' })
    // 三份文件都有可用备份时各自显示撤销入口
    expect(undoButtons).toHaveLength(3)
    service.backupState.mockResolvedValue({ available: false })
    await user.click(undoButtons[0])
    await waitFor(() => expect(service.undo).toHaveBeenCalledWith('USER.md'))
    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: '撤销上次模型编辑' })).toHaveLength(0)
    )
  })
})
