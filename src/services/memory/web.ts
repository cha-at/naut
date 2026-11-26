import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { sha256 } from './hash.js'
import { memoryTemplate } from './templates.js'
import { normalizeText, utf8ByteLength, windowContent } from './text.js'
import {
  MemoryError,
  MEMORY_FILE_MAX_BYTES,
  MEMORY_FILE_NAMES,
  isMemoryFileName,
  type MemoryAdapter,
  type MemoryBackupState,
  type MemoryEditOutcome,
  type MemoryEntry,
  type MemoryFile,
  type MemoryListResult,
  type MemoryPaths,
  type MemoryReadResult,
} from './types.js'

/** Web 端用独立 IndexedDB 模拟记忆目录：只能保存两份固定文档，不支持新建/重命名/删除 */

type StoredFile = { name: string; content: string; updatedAt: number }

type StoredBackup = {
  name: string
  content: string
  /** 写入后内容的哈希，撤销前要求当前内容仍等于它 */
  editedHash: string
  editedAt: number
  backupId: string
  toolUseId: string
}

interface MemoryDB extends DBSchema {
  files: { key: string; value: StoredFile }
  backups: { key: string; value: StoredBackup }
}

const DB_NAME = 'naut-memory'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<MemoryDB>> | null = null

const getDB = () =>
  (dbPromise ??= openDB<MemoryDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'name' })
      }
      if (!db.objectStoreNames.contains('backups')) {
        db.createObjectStore('backups', { keyPath: 'name' })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许重试，避免一直复用已拒绝的 Promise
    dbPromise = null
    throw new MemoryError('root_unavailable', error instanceof Error ? error.message : undefined)
  }))

/** 每个文件一条 Promise 链，保证读改写不交错 */
const queues = new Map<string, Promise<unknown>>()

const runExclusive = <T>(name: string, task: () => Promise<T>): Promise<T> => {
  const previous = queues.get(name) ?? Promise.resolve()
  const next = previous.then(task, task)
  queues.set(
    name,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError')
  }
}

const assertMemoryName = (name: string) => {
  if (!isMemoryFileName(name)) {
    throw new MemoryError('not_found', `${name} is not a memory file`)
  }
}

const entryOf = (record: StoredFile): MemoryEntry => ({
  name: record.name,
  size: utf8ByteLength(record.content),
  modifiedAt: record.updatedAt,
  isMemory: true,
})

const fileOf = async (record: StoredFile): Promise<MemoryFile> => ({
  ...entryOf(record),
  content: record.content,
  hash: await sha256(record.content),
})

/** 首次访问写入模板；已存在的文件不覆盖 */
const ensureFile = async (name: string): Promise<StoredFile> => {
  assertMemoryName(name)
  const db = await getDB()
  const existing = await db.get('files', name)
  if (existing) {
    return existing
  }
  const template = memoryTemplate(name) ?? ''
  const record: StoredFile = { name, content: template, updatedAt: Date.now() }
  try {
    await db.add('files', record)
    return record
  } catch {
    // 另一个标签页可能刚写入，读回最新值即可
    const current = await db.get('files', name)
    if (current) {
      return current
    }
    throw new MemoryError('io')
  }
}

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

const replaceMatches = (
  haystack: string,
  needle: string,
  replacement: string,
  replaceAll: boolean
): string =>
  replaceAll
    ? haystack.split(needle).join(replacement)
    : haystack.replace(needle, () => replacement)

const readFile = async (name: string, offset = 1, limit?: number): Promise<MemoryReadResult> => {
  const record = await ensureFile(name)
  const window = windowContent(record.content, offset, limit)
  return {
    ...entryOf(record),
    content: window.content,
    hash: await sha256(record.content),
    startLine: window.startLine,
    endLine: window.endLine,
    totalLines: window.totalLines,
    truncated: window.truncated,
    lineTruncated: window.lineTruncated,
  }
}

export const webMemoryAdapter: MemoryAdapter = {
  kind: 'web',

  paths: async (): Promise<MemoryPaths> => ({
    root: null,
    platform: 'web',
    files: MEMORY_FILE_NAMES.map((name) => ({ name, path: null, isMemory: true })),
  }),

  list: async (): Promise<MemoryListResult> => {
    await Promise.all(MEMORY_FILE_NAMES.map(ensureFile))
    const db = await getDB()
    const records = await Promise.all(MEMORY_FILE_NAMES.map((name) => db.get('files', name)))
    return {
      entries: records.filter((record): record is StoredFile => Boolean(record)).map(entryOf),
      truncated: false,
    }
  },

  create: async () => {
    throw new MemoryError('read_only', 'The browser stores two fixed memory files')
  },

  rename: async () => {
    throw new MemoryError('read_only', 'The browser stores two fixed memory files')
  },

  remove: async () => {
    throw new MemoryError('read_only', 'The browser stores two fixed memory files')
  },

  read: (name, offset, limit) => runExclusive(name, () => readFile(name, offset, limit)),

  readFull: (name) =>
    runExclusive(name, async () => {
      const record = await ensureFile(name)
      return fileOf(record)
    }),

  write: (name, content, expectedHash) =>
    runExclusive(name, async () => {
      assertMemoryName(name)
      const normalized = normalizeText(content)
      if (utf8ByteLength(normalized) > MEMORY_FILE_MAX_BYTES) {
        throw new MemoryError('too_large')
      }
      const db = await getDB()
      if (expectedHash !== undefined) {
        const current = await db.get('files', name)
        const currentHash = current ? await sha256(current.content) : null
        if (currentHash !== expectedHash) {
          throw new MemoryError('conflict')
        }
      }
      const record: StoredFile = { name, content: normalized, updatedAt: Date.now() }
      const tx = db.transaction(['files', 'backups'], 'readwrite')
      await tx.objectStore('files').put(record)
      // 用户保存后旧的模型撤销备份失效
      await tx.objectStore('backups').delete(name)
      await tx.done
      return fileOf(record)
    }),

  edit: (name, oldString, newString, replaceAll, toolUseId, signal) =>
    runExclusive(name, async (): Promise<MemoryEditOutcome> => {
      abortIfNeeded(signal)
      assertMemoryName(name)
      const oldText = normalizeText(oldString)
      const newText = normalizeText(newString)
      if (!oldText) {
        throw new MemoryError('invalid_argument', 'old_string must not be empty')
      }
      const db = await getDB()
      const current = await ensureFile(name)
      abortIfNeeded(signal)
      const before = current.content
      const replacements =
        oldText === newText ? 0 : countOccurrences(before, oldText)
      if (oldText === newText) {
        // 无实际变化：不写盘、不创建备份
        return {
          entry: entryOf(current),
          replacements: 0,
          hash: await sha256(before),
        }
      }
      if (replacements === 0 || (!replaceAll && replacements > 1)) {
        throw new MemoryError(
          'no_match',
          replacements === 0
            ? 'old_string was not found; read the file again'
            : `old_string appears ${replacements} times; read the file and replace_all or pick a unique snippet`
        )
      }
      const next = replaceMatches(before, oldText, newText, replaceAll)
      if (utf8ByteLength(next) > MEMORY_FILE_MAX_BYTES) {
        throw new MemoryError('too_large')
      }
      abortIfNeeded(signal)
      const editedHash = await sha256(next)
      const editedAt = Date.now()
      const backup: StoredBackup = {
        name,
        content: before,
        editedHash,
        editedAt,
        backupId: `${editedAt}-${editedHash.slice(0, 8)}`,
        toolUseId,
      }
      const record: StoredFile = { name, content: next, updatedAt: editedAt }
      const tx = db.transaction(['files', 'backups'], 'readwrite')
      await tx.objectStore('backups').put(backup)
      await tx.objectStore('files').put(record)
      await tx.done
      return {
        entry: entryOf(record),
        replacements: replaceAll ? replacements : 1,
        backupId: backup.backupId,
        hash: editedHash,
      }
    }),

  undo: (name, signal) =>
    runExclusive(name, async (): Promise<MemoryFile> => {
      abortIfNeeded(signal)
      assertMemoryName(name)
      const db = await getDB()
      const backup = await db.get('backups', name)
      if (!backup) {
        throw new MemoryError('no_backup')
      }
      const current = await db.get('files', name)
      if (!current) {
        throw new MemoryError('not_found')
      }
      if ((await sha256(current.content)) !== backup.editedHash) {
        throw new MemoryError('backup_stale')
      }
      abortIfNeeded(signal)
      const record: StoredFile = { name, content: backup.content, updatedAt: Date.now() }
      const tx = db.transaction(['files', 'backups'], 'readwrite')
      await tx.objectStore('files').put(record)
      await tx.objectStore('backups').delete(name)
      await tx.done
      return fileOf(record)
    }),

  backupState: async (name): Promise<MemoryBackupState> => {
    if (!isMemoryFileName(name)) {
      return { available: false }
    }
    const db = await getDB()
    const backup = await db.get('backups', name)
    if (!backup) {
      return { available: false }
    }
    const current = await db.get('files', name)
    if (!current) {
      return { available: false }
    }
    const available = (await sha256(current.content)) === backup.editedHash
    return available
      ? {
          available,
          backupId: backup.backupId,
          editedAt: backup.editedAt,
          editedHash: backup.editedHash,
        }
      : { available: false }
  },
}

/** 测试用：丢弃连接并删除数据库，保证用例之间互不影响 */
export const resetWebMemoryDatabase = async (): Promise<void> => {
  queues.clear()
  if (dbPromise) {
    try {
      ;(await dbPromise).close()
    } catch {
      // 连接已失效
    }
    dbPromise = null
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'))
    request.onblocked = () => resolve()
  })
}
