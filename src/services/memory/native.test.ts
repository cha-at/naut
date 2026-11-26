import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { nativeMemoryAdapter } from './native.js'
import { MEMORY_TEMPLATES } from './templates.js'
import { MemoryError } from './types.js'

const entry = (name = 'USER.md', overrides: Record<string, unknown> = {}) => ({
  name,
  size: 12,
  modified_at: 1_700_000_000_000,
  is_memory: name === 'USER.md' || name === 'MEMORY.md',
  ...overrides,
})

beforeEach(() => {
  mocks.invoke.mockReset()
})

describe('原生适配器：命令与字段映射', () => {
  it('paths 把 snake_case 映射为 camelCase，并透传 root', async () => {
    mocks.invoke.mockResolvedValueOnce({
      root: 'C:\\Users\\me\\.naut',
      platform: 'windows',
      files: [
        { name: 'USER.md', path: 'C:\\Users\\me\\.naut\\USER.md', is_memory: true },
        { name: 'MEMORY.md', path: 'C:\\Users\\me\\.naut\\MEMORY.md', is_memory: true },
      ],
    })
    await expect(nativeMemoryAdapter.paths()).resolves.toEqual({
      root: 'C:\\Users\\me\\.naut',
      platform: 'windows',
      files: [
        { name: 'USER.md', path: 'C:\\Users\\me\\.naut\\USER.md', isMemory: true },
        { name: 'MEMORY.md', path: 'C:\\Users\\me\\.naut\\MEMORY.md', isMemory: true },
      ],
    })
    expect(mocks.invoke).toHaveBeenCalledWith('memory_paths', undefined)
  })

  it('list 映射条目并保留截断标记', async () => {
    mocks.invoke.mockResolvedValueOnce({
      entries: [entry('USER.md'), entry('notes.md', { is_memory: false })],
      truncated: true,
    })
    const list = await nativeMemoryAdapter.list()
    expect(list.truncated).toBe(true)
    expect(list.entries[1]).toEqual({
      name: 'notes.md',
      size: 12,
      modifiedAt: 1_700_000_000_000,
      isMemory: false,
    })
  })

  it('read 传 offset/limit 并映射窗口字段', async () => {
    mocks.invoke.mockResolvedValueOnce({
      ...entry('USER.md'),
      content: '第 50 行',
      start_line: 50,
      end_line: 50,
      total_lines: 120,
      hash: 'abc',
      truncated: true,
      line_truncated: false,
    })
    const result = await nativeMemoryAdapter.read('USER.md', 50, 1)
    expect(result).toMatchObject({
      content: '第 50 行',
      startLine: 50,
      endLine: 50,
      totalLines: 120,
      truncated: true,
      lineTruncated: false,
      hash: 'abc',
      isMemory: true,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('memory_read', { name: 'USER.md', offset: 50, limit: 1 })
  })

  it('readFull 按文件名补 isMemory，并在超过 64 KiB 时接受 hash=null', async () => {
    mocks.invoke.mockResolvedValueOnce({
      name: 'USER.md',
      content: '# USER.md',
      size: 70_000,
      modified_at: 1,
      hash: null,
    })
    const file = await nativeMemoryAdapter.readFull('USER.md')
    expect(file).toMatchObject({ name: 'USER.md', content: '# USER.md', hash: null, isMemory: true })
    expect(mocks.invoke).toHaveBeenCalledWith('memory_read_full', { name: 'USER.md' })
  })

  it('write 发送 LF 归一化后的内容并返回哈希', async () => {
    mocks.invoke.mockResolvedValueOnce({ entry: entry('MEMORY.md'), hash: 'def' })
    const file = await nativeMemoryAdapter.write('MEMORY.md', 'a\r\nb', 'expected')
    expect(file).toMatchObject({ content: 'a\nb', hash: 'def', isMemory: true })
    expect(mocks.invoke).toHaveBeenCalledWith('memory_write', {
      name: 'MEMORY.md',
      content: 'a\nb',
      expectedHash: 'expected',
    })
  })

  it('edit 映射替换处数与备份 ID，空备份 ID 视为没有备份', async () => {
    mocks.invoke.mockResolvedValueOnce({
      entry: entry('MEMORY.md'),
      replacements: 1,
      backup_id: '1700000000000-deadbeef',
      hash: 'h',
    })
    const outcome = await nativeMemoryAdapter.edit(
      'MEMORY.md',
      '旧',
      '新',
      false,
      'toolu_1'
    )
    expect(outcome).toMatchObject({
      replacements: 1,
      backupId: '1700000000000-deadbeef',
      hash: 'h',
    })
    expect(mocks.invoke).toHaveBeenCalledWith('memory_edit', {
      name: 'MEMORY.md',
      oldString: '旧',
      newString: '新',
      replaceAll: false,
      toolUseId: 'toolu_1',
    })

    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValueOnce({
      entry: entry('MEMORY.md'),
      replacements: 0,
      backup_id: '',
      hash: 'h',
    })
    const noop = await nativeMemoryAdapter.edit('MEMORY.md', '同', '同', false, 'toolu_2')
    expect(noop.backupId).toBeUndefined()
  })

  it('undo 先撤销再读回全文', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ entry: entry('USER.md'), hash: 'old' })
      .mockResolvedValueOnce({
        name: 'USER.md',
        content: '恢复后的内容',
        size: 21,
        modified_at: 2,
        hash: 'old',
      })
    const file = await nativeMemoryAdapter.undo('USER.md')
    expect(file).toMatchObject({ content: '恢复后的内容', hash: 'old', isMemory: true })
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'memory_undo', { name: 'USER.md' })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'memory_read_full', { name: 'USER.md' })
  })

  it('backupState 映射可选字段', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        available: true,
        backup_id: 'b1',
        edited_at: 123,
        edited_hash: 'h1',
      })
      .mockResolvedValueOnce({ available: false })
    await expect(nativeMemoryAdapter.backupState('USER.md')).resolves.toEqual({
      available: true,
      backupId: 'b1',
      editedAt: 123,
      editedHash: 'h1',
    })
    await expect(nativeMemoryAdapter.backupState('USER.md')).resolves.toEqual({
      available: false,
      backupId: undefined,
      editedAt: undefined,
      editedHash: undefined,
    })
  })
})

describe('原生适配器：错误归一化', () => {
  it('稳定错误码转成 MemoryError，未知码按 io 处理', async () => {
    mocks.invoke.mockRejectedValueOnce({ code: 'too_large', message: 'File exceeds the 64 KiB limit' })
    await expect(nativeMemoryAdapter.write('USER.md', 'x')).rejects.toMatchObject({
      code: 'too_large',
      message: 'File exceeds the 64 KiB limit',
    })

    mocks.invoke.mockRejectedValueOnce({ code: 'mystery', message: 'boom' })
    const error = await nativeMemoryAdapter.list().catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(MemoryError)
    expect((error as MemoryError).code).toBe('io')
  })

  it('模板内容与 Rust 侧一致，用于对比契约', () => {
    expect(MEMORY_TEMPLATES['USER.md']).toContain('# USER.md')
    expect(MEMORY_TEMPLATES['MEMORY.md']).toContain('# MEMORY.md')
  })
})
