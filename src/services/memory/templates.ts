import type { TranslationKey } from '../../i18n/index.js'
import { FILE_NAME_MAX, isMemoryFileName, MEMORY_FILE_NAMES } from './types.js'

/**
 * 两份记忆文件的初始模板。只含标题、用途注释与空行；
 * 原生端（src-tauri/src/memory.rs）使用完全相同的文本。
 */
export const MEMORY_TEMPLATES: Record<string, string> = {
  'USER.md': '# USER.md\n\n> 用户偏好与资料；对话开始时会自动注入。\n\n',
  'MEMORY.md': '# MEMORY.md\n\n> 长期记忆；对话开始时会自动注入。\n\n',
}

export const memoryTemplate = (name: string): string | null =>
  isMemoryFileName(name) ? MEMORY_TEMPLATES[name] : null

/** 保留名比较不区分大小写，Windows 上 user.md 与 USER.md 视为同一文件 */
export const memoryNameKey = (name: string) => name.trim().toLocaleLowerCase()

export const isReservedMemoryName = (name: string) =>
  MEMORY_FILE_NAMES.some((item) => memoryNameKey(item) === memoryNameKey(name))

/** 控制字符（含 NUL、换行、DEL）不允许出现在文件名里 */
const hasControlChar = (value: string) => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * 额外文件名规则：1–64 字符，不含路径分隔符与控制字符，不是「.」「..」，不以「.」开头。
 * 返回可展示的错误文案键，合法时返回 null。
 */
export const memoryFileNameError = (name: string): TranslationKey | null => {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > FILE_NAME_MAX) {
    return 'memoryFileNameInvalid'
  }
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    return 'memoryFileNameInvalid'
  }
  if (/[\\/]/.test(trimmed) || hasControlChar(trimmed)) {
    return 'memoryFileNameInvalid'
  }
  if (isReservedMemoryName(trimmed)) {
    return 'memoryReservedName'
  }
  return null
}

/** 新建额外文件时自动补 .md，已带扩展名则保留 */
export const withMarkdownExtension = (name: string) => {
  const trimmed = name.trim()
  return /\.[^./\\]+$/.test(trimmed) ? trimmed : `${trimmed}.md`
}
