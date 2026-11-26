import { isTauri } from '../../platform/env.js'
import { nativeMemoryAdapter } from './native.js'
import { webMemoryAdapter } from './web.js'
import { truncateToBytes } from './text.js'
import { memoryFileNameError, isReservedMemoryName, memoryNameKey, withMarkdownExtension } from './templates.js'
import {
  MEMORY_FILE_NAMES,
  MEMORY_SNAPSHOT_MAX_BYTES,
  READ_MAX_LINES,
  isMemoryFileName,
  memoryErrorFrom,
  type MemoryAdapter,
  type MemoryBackupState,
  type MemoryEditOutcome,
  type MemoryEntry,
  type MemoryFile,
  type MemoryListResult,
  type MemoryPaths,
  type MemoryReadResult,
  type MemorySnapshot,
} from './types.js'

/**
 * 记忆服务门面：UI 与工具都从这里访问存储，不直接 invoke / indexedDB。
 * 适配器在模块加载时确定：Tauri 内用原生命令，浏览器用 IndexedDB。
 */
export const memoryAdapter: MemoryAdapter = isTauri() ? nativeMemoryAdapter : webMemoryAdapter

export const isNativeMemory = () => memoryAdapter.kind === 'native'

/** 首次访问确保两份记忆文件存在（原生端按模板创建） */
export const ensureMemoryTemplates = async (): Promise<void> => {
  await Promise.all(MEMORY_FILE_NAMES.map((name) => memoryAdapter.read(name, 1, 1)))
}

/**
 * 读取新对话要注入的快照：两份记忆并发读取，各自截断到 16 KiB。
 * 读取或创建失败时抛错，由调用方阻止发送，不用空快照继续。
 */
export const readMemorySnapshot = async (): Promise<MemorySnapshot> => {
  const [user, memory] = await Promise.all(
    MEMORY_FILE_NAMES.map((name) => memoryAdapter.read(name, 1, READ_MAX_LINES))
  )
  const userText = truncateToBytes(user.content, MEMORY_SNAPSHOT_MAX_BYTES)
  const memoryText = truncateToBytes(memory.content, MEMORY_SNAPSHOT_MAX_BYTES)
  return {
    user: userText.content,
    memory: memoryText.content,
    userTruncated: userText.truncated,
    memoryTruncated: memoryText.truncated,
    capturedAt: Date.now(),
  }
}

export const memoryService = {
  get kind() {
    return memoryAdapter.kind
  },
  isNative: isNativeMemory,
  paths: (): Promise<MemoryPaths> => memoryAdapter.paths(),
  list: (): Promise<MemoryListResult> => memoryAdapter.list(),
  create: (name: string): Promise<MemoryEntry> => memoryAdapter.create(name),
  rename: (oldName: string, newName: string): Promise<MemoryEntry> =>
    memoryAdapter.rename(oldName, newName),
  remove: (name: string): Promise<void> => memoryAdapter.remove(name),
  read: (name: string, offset?: number, limit?: number): Promise<MemoryReadResult> =>
    memoryAdapter.read(name, offset, limit),
  readFull: (name: string): Promise<MemoryFile> => memoryAdapter.readFull(name),
  write: (name: string, content: string, expectedHash?: string): Promise<MemoryFile> =>
    memoryAdapter.write(name, content, expectedHash),
  edit: (
    name: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    toolUseId: string,
    signal?: AbortSignal
  ): Promise<MemoryEditOutcome> =>
    memoryAdapter.edit(name, oldString, newString, replaceAll, toolUseId, signal),
  undo: (name: string, signal?: AbortSignal): Promise<MemoryFile> =>
    memoryAdapter.undo(name, signal),
  backupState: (name: string): Promise<MemoryBackupState> => memoryAdapter.backupState(name),
  readSnapshot: readMemorySnapshot,
  ensureTemplates: ensureMemoryTemplates,
  isMemoryName: isMemoryFileName,
  normalizeError: memoryErrorFrom,
  memoryFileNameError,
  isReservedMemoryName,
  memoryNameKey,
  withMarkdownExtension,
}

export type { MemoryAdapter, MemoryBackupState, MemoryEditOutcome, MemoryEntry, MemoryFile, MemoryListResult, MemoryPaths, MemoryReadResult, MemorySnapshot }
