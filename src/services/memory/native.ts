import { isMemoryFileName } from './types.js'
import { normalizeText } from './text.js'
import {
  MemoryError,
  memoryErrorFrom,
  type MemoryAdapter,
  type MemoryBackupState,
  type MemoryEditOutcome,
  type MemoryEntry,
  type MemoryFile,
  type MemoryListResult,
  type MemoryPaths,
  type MemoryReadResult,
} from './types.js'

/**
 * 原生端适配器：只调用 src-tauri/src/memory.rs 注册的命令，不直接暴露文件系统。
 * 命令参数按 Tauri 约定用 camelCase，响应字段是 Rust 序列化的 snake_case。
 */

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw memoryErrorFrom(error)
  }
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    throw new MemoryError('io', 'Unexpected memory command response')
  }
  return value as Record<string, unknown>
}

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const entryOf = (value: unknown): MemoryEntry => {
  const record = asRecord(value)
  if (typeof record.name !== 'string') {
    throw new MemoryError('io', 'Unexpected memory entry')
  }
  return {
    name: record.name,
    size: asNumber(record.size),
    modifiedAt: asNumber(record.modified_at),
    isMemory: record.is_memory === true,
  }
}

const fileOf = (file: unknown, content: string, hash: string | null): MemoryFile => ({
  ...entryOf(file),
  content,
  hash,
})

export const nativeMemoryAdapter: MemoryAdapter = {
  kind: 'native',

  paths: async (): Promise<MemoryPaths> => {
    const raw = asRecord(await call<unknown>('memory_paths'))
    const files = Array.isArray(raw.files) ? raw.files : []
    return {
      root: typeof raw.root === 'string' ? raw.root : null,
      platform: typeof raw.platform === 'string' ? raw.platform : 'native',
      files: files.flatMap((item) => {
        const record = asRecord(item)
        return typeof record.name === 'string'
          ? [
              {
                name: record.name,
                path: typeof record.path === 'string' ? record.path : null,
                isMemory: record.is_memory === true,
              },
            ]
          : []
      }),
    }
  },

  list: async (): Promise<MemoryListResult> => {
    const raw = asRecord(await call<unknown>('memory_list'))
    const entries = Array.isArray(raw.entries) ? raw.entries.map(entryOf) : []
    return { entries, truncated: raw.truncated === true }
  },

  create: async (name) => {
    const raw = asRecord(await call<unknown>('memory_create', { name }))
    return entryOf(raw.entry)
  },

  rename: async (oldName, newName) => {
    const raw = asRecord(await call<unknown>('memory_rename', { oldName, newName }))
    return entryOf(raw.entry)
  },

  remove: async (name) => {
    await call('memory_delete', { name })
  },

  read: async (name, offset, limit): Promise<MemoryReadResult> => {
    const raw = asRecord(
      await call<unknown>('memory_read', {
        name,
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit }),
      })
    )
    return {
      ...entryOf(raw),
      content: typeof raw.content === 'string' ? raw.content : '',
      hash: typeof raw.hash === 'string' ? raw.hash : null,
      startLine: asNumber(raw.start_line, 1),
      endLine: asNumber(raw.end_line),
      totalLines: asNumber(raw.total_lines),
      truncated: raw.truncated === true,
      lineTruncated: raw.line_truncated === true,
    }
  },

  readFull: async (name): Promise<MemoryFile> => {
    const raw = asRecord(await call<unknown>('memory_read_full', { name }))
    return {
      ...entryOf(raw),
      // memory_read_full 不返回 is_memory，按文件名判断
      isMemory: isMemoryFileName(name),
      content: typeof raw.content === 'string' ? raw.content : '',
      hash: typeof raw.hash === 'string' ? raw.hash : null,
    }
  },

  write: async (name, content, expectedHash): Promise<MemoryFile> => {
    // 原生端按 LF 归一化后写入，返回值也用同一份文本
    const normalized = normalizeText(content)
    const raw = asRecord(
      await call<unknown>('memory_write', {
        name,
        content: normalized,
        ...(expectedHash === undefined ? {} : { expectedHash }),
      })
    )
    return fileOf(raw.entry, normalized, typeof raw.hash === 'string' ? raw.hash : null)
  },

  edit: async (name, oldString, newString, replaceAll, toolUseId): Promise<MemoryEditOutcome> => {
    const raw = asRecord(
      await call<unknown>('memory_edit', { name, oldString, newString, replaceAll, toolUseId })
    )
    return {
      entry: entryOf(raw.entry),
      replacements: asNumber(raw.replacements),
      // 未写盘时原生端返回空字符串，按「没有备份」处理
      backupId: typeof raw.backup_id === 'string' && raw.backup_id ? raw.backup_id : undefined,
      hash: typeof raw.hash === 'string' ? raw.hash : '',
    }
  },

  undo: async (name): Promise<MemoryFile> => {
    await call('memory_undo', { name })
    // 撤销后的正文由编辑器与列表直接使用，读回完整内容
    return nativeMemoryAdapter.readFull(name)
  },

  backupState: async (name): Promise<MemoryBackupState> => {
    const raw = asRecord(await call<unknown>('memory_backup_state', { name }))
    return {
      available: raw.available === true,
      backupId: typeof raw.backup_id === 'string' ? raw.backup_id : undefined,
      editedAt: typeof raw.edited_at === 'number' ? raw.edited_at : undefined,
      editedHash: typeof raw.edited_hash === 'string' ? raw.edited_hash : undefined,
    }
  },
}
