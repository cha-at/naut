import type { TranslationKey } from '../../i18n/index.js'

/** 两份记忆文件：新对话开始时自动注入快照 */
export const MEMORY_FILE_NAMES = ['USER.md', 'MEMORY.md'] as const
export type MemoryFileName = (typeof MEMORY_FILE_NAMES)[number]

/** 单文件上限：读取仍可用，编辑与保存拒绝 */
export const MEMORY_FILE_MAX_BYTES = 64 * 1024
/** 每份记忆注入系统提示词的上限 */
export const MEMORY_SNAPSHOT_MAX_BYTES = 16 * 1024
/** 记忆目录最多普通文件数 */
export const MEMORY_DIR_MAX_FILES = 200
/** read 工具单次最多行数与字节数 */
export const READ_MAX_LINES = 2000
export const READ_MAX_BYTES = 32 * 1024
/** read 工具单行最长字符数，超出截断并标注 */
export const READ_MAX_LINE_CHARS = 2000
/** 文件名最长字符数 */
export const FILE_NAME_MAX = 64
/** 一条回复内最多工具执行轮次 */
export const TOOL_ROUND_LIMIT = 12
/** 连续存储错误达到该次数时提前收尾 */
export const TOOL_STORAGE_FAILURE_LIMIT = 3

export type MemoryEntry = {
  name: string
  size: number
  modifiedAt: number
  isMemory: boolean
}

export type MemoryFile = MemoryEntry & {
  content: string
  /** 全文 SHA-256；文件超过 64 KiB 时为 null */
  hash: string | null
}

/** read 的窗口结果：content 是窗口内的原始文本（不带行号） */
export type MemoryReadResult = MemoryFile & {
  startLine: number
  endLine: number
  totalLines: number
  /** 还有未返回的行 */
  truncated: boolean
  /** 有单行被截断并追加了标记 */
  lineTruncated: boolean
}

export type MemoryBackupState = {
  available: boolean
  backupId?: string
  editedAt?: number
  editedHash?: string
}

export type MemoryEditOutcome = {
  entry: MemoryEntry
  replacements: number
  backupId?: string
  hash: string
}

export type MemoryPathEntry = {
  name: string
  /** Web 端没有真实路径 */
  path: string | null
  isMemory: boolean
}

export type MemoryPaths = {
  /** Web 端为 null */
  root: string | null
  platform: string
  files: MemoryPathEntry[]
}

export type MemoryListResult = {
  entries: MemoryEntry[]
  truncated: boolean
}

/** 会话首条消息前捕获的两份记忆快照 */
export type MemorySnapshot = {
  user: string
  memory: string
  userTruncated?: boolean
  memoryTruncated?: boolean
  capturedAt: number
}

/**
 * 稳定错误码：原生命令与 Web 适配器返回同一套；
 * invalid_argument / no_match 是工具参数与字面匹配的补充码（不属于存储错误）。
 */
export type MemoryErrorCode =
  | 'not_found'
  | 'not_file'
  | 'invalid_path'
  | 'exists'
  | 'too_large'
  | 'too_many_files'
  | 'binary'
  | 'permission'
  | 'io'
  | 'no_backup'
  | 'backup_stale'
  | 'conflict'
  | 'root_unavailable'
  | 'read_only'
  | 'invalid_argument'
  | 'no_match'

const ERROR_TEXT: Record<MemoryErrorCode, string> = {
  not_found: 'File not found',
  not_file: 'Not a regular file',
  invalid_path: 'Path must be a file name inside the memory directory',
  exists: 'A file with this name already exists',
  too_large: 'File exceeds the 64 KiB limit',
  too_many_files: 'The memory directory already holds 200 files',
  binary: 'File is not UTF-8 text',
  permission: 'Permission denied',
  io: 'Storage error',
  no_backup: 'No undo backup for this file',
  backup_stale: 'The file changed after the last model edit',
  conflict: 'The file changed outside the app',
  root_unavailable: 'The memory directory is unavailable',
  read_only: 'This operation is not available on this platform',
  invalid_argument: 'Invalid tool arguments',
  no_match: 'The text was not found',
}

const ERROR_KEYS: Record<MemoryErrorCode, TranslationKey> = {
  not_found: 'memoryErrorNotFound',
  not_file: 'memoryErrorNotFile',
  invalid_path: 'memoryErrorInvalidPath',
  exists: 'memoryErrorExists',
  too_large: 'memoryErrorTooLarge',
  too_many_files: 'memoryErrorTooManyFiles',
  binary: 'memoryErrorBinary',
  permission: 'memoryErrorPermission',
  io: 'memoryErrorIo',
  no_backup: 'memoryErrorNoBackup',
  backup_stale: 'memoryErrorBackupStale',
  conflict: 'memoryErrorConflict',
  root_unavailable: 'memoryErrorRootUnavailable',
  read_only: 'memoryErrorReadOnly',
  invalid_argument: 'memoryErrorInvalidArgument',
  no_match: 'memoryErrorNoMatch',
}

const CODES = new Set<string>(Object.keys(ERROR_TEXT))

export class MemoryError extends Error {
  readonly code: MemoryErrorCode

  constructor(code: MemoryErrorCode, message?: string) {
    super(message ?? ERROR_TEXT[code])
    this.name = 'MemoryError'
    this.code = code
  }
}

export const isMemoryError = (error: unknown): error is MemoryError =>
  error instanceof MemoryError

export const memoryErrorCode = (error: unknown): MemoryErrorCode =>
  isMemoryError(error) ? error.code : 'io'

/** 工具结果里的错误文本；不含文件正文 */
export const memoryErrorText = (error: unknown): string => {
  if (isMemoryError(error)) {
    return error.message || ERROR_TEXT[error.code]
  }
  return error instanceof Error && error.message ? error.message : ERROR_TEXT.io
}

/** 界面上展示的本地化文案键 */
export const memoryErrorKey = (error: unknown): TranslationKey =>
  ERROR_KEYS[memoryErrorCode(error)]

/** Rust 命令返回 { code, message }；未知码按 io 处理，保留原始文本 */
export const memoryErrorFrom = (value: unknown): MemoryError => {
  if (isMemoryError(value)) {
    return value
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.code === 'string' && CODES.has(record.code)) {
      return new MemoryError(
        record.code as MemoryErrorCode,
        typeof record.message === 'string' && record.message ? record.message : undefined
      )
    }
  }
  if (value instanceof Error) {
    return new MemoryError('io', value.message || ERROR_TEXT.io)
  }
  return new MemoryError('io')
}

export const isMemoryFileName = (name: string): name is MemoryFileName =>
  MEMORY_FILE_NAMES.includes(name as MemoryFileName)

/** 原生 / Web 适配器统一接口；UI 与工具只通过门面访问 */
export interface MemoryAdapter {
  readonly kind: 'native' | 'web'
  paths(): Promise<MemoryPaths>
  list(): Promise<MemoryListResult>
  /** 新建空文件；只有原生端支持 */
  create(name: string): Promise<MemoryEntry>
  rename(oldName: string, newName: string): Promise<MemoryEntry>
  remove(name: string): Promise<void>
  read(name: string, offset?: number, limit?: number): Promise<MemoryReadResult>
  /** 编辑器用：返回完整内容，不做行号窗口与单行截断 */
  readFull(name: string): Promise<MemoryFile>
  write(name: string, content: string, expectedHash?: string): Promise<MemoryFile>
  edit(
    name: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    toolUseId: string,
    signal?: AbortSignal
  ): Promise<MemoryEditOutcome>
  undo(name: string, signal?: AbortSignal): Promise<MemoryFile>
  backupState(name: string): Promise<MemoryBackupState>
}
