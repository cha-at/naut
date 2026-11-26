import { create } from 'zustand'
import { type TranslationKey } from '../../i18n/index.js'
import { memoryService } from './index.js'
import { memoryErrorKey, memoryErrorText } from './types.js'

/**
 * 每个文件的「最近一次模型编辑」备份状态。
 * 卡片和记忆列表据此显示撤销入口；撤销前还会由存储层再校验一次内容哈希。
 */

export type MemoryUndoEntry = {
  available: boolean
  backupId?: string
  editedAt?: number
  /** 最近一次刷新时间，避免并发刷新互相覆盖时展示过期状态 */
  checkedAt: number
}

type MemoryUndoState = {
  entries: Record<string, MemoryUndoEntry>
}

export const useMemoryUndo = create<MemoryUndoState>(() => ({ entries: {} }))

const upsert = (name: string, entry: MemoryUndoEntry) =>
  useMemoryUndo.setState((state) => ({
    entries: { ...state.entries, [name]: entry },
  }))

/** 查询并缓存某个文件的撤销可用性；读取失败按不可用处理 */
export const refreshMemoryUndo = async (name: string): Promise<MemoryUndoEntry> => {
  try {
    const state = await memoryService.backupState(name)
    const entry: MemoryUndoEntry = {
      available: state.available,
      backupId: state.backupId,
      editedAt: state.editedAt,
      checkedAt: Date.now(),
    }
    upsert(name, entry)
    return entry
  } catch {
    const entry: MemoryUndoEntry = { available: false, checkedAt: Date.now() }
    upsert(name, entry)
    return entry
  }
}

export const refreshMemoryUndoAll = (names: string[]): Promise<MemoryUndoEntry[]> =>
  Promise.all([...new Set(names)].map(refreshMemoryUndo))

export const forgetMemoryUndo = (name: string) =>
  useMemoryUndo.setState((state) => ({
    entries: Object.fromEntries(
      Object.entries(state.entries).filter(([key]) => key !== name)
    ),
  }))

/** backupId 给定时要求与该次编辑的备份一致，避免旧卡片撤销新备份 */
export const isMemoryUndoAvailable = (name: string, backupId?: string): boolean => {
  const entry = useMemoryUndo.getState().entries[name]
  return Boolean(entry?.available && (!backupId || entry.backupId === backupId))
}

export type UndoResult = { ok: true } | { ok: false; error: TranslationKey; message: string }

/** 撤销最近一次模型编辑，并刷新该文件的备份状态 */
export const undoMemoryEdit = async (name: string): Promise<UndoResult> => {
  try {
    await memoryService.undo(name)
    await refreshMemoryUndo(name)
    return { ok: true }
  } catch (error) {
    await refreshMemoryUndo(name)
    return { ok: false, error: memoryErrorKey(error), message: memoryErrorText(error) }
  }
}
