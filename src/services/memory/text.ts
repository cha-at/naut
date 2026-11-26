import { READ_MAX_BYTES, READ_MAX_LINE_CHARS, READ_MAX_LINES } from './types.js'

const encoder = new TextEncoder()

export const utf8ByteLength = (text: string): number => encoder.encode(text).length

/** 统一 LF、去掉 UTF-8 BOM；写入与比较都用归一化后的内容 */
export const normalizeText = (text: string): string =>
  (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, '\n')

/** 行数口径与 Rust 的 str::lines 一致：末尾换行不产生空行，空文件为 0 行 */
export const splitLines = (text: string): string[] => {
  const normalized = normalizeText(text)
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return body === '' ? [] : body.split('\n')
}

/** 单行超长时的截断标记，工具结果与原生端保持一致 */
export const LINE_TRUNCATED_SUFFIX = ' … (line truncated)'

export type ContentWindow = {
  content: string
  startLine: number
  endLine: number
  totalLines: number
  truncated: boolean
  lineTruncated: boolean
}

/**
 * 按 offset / limit / 32 KiB 预算截取内容窗口。
 * 至少返回一行；单行超过 2000 字符时截断并标记。
 */
export const windowContent = (text: string, offset = 1, limit = READ_MAX_LINES): ContentWindow => {
  const lines = splitLines(text)
  const totalLines = lines.length
  const start = Math.max(1, Math.trunc(offset) || 1)
  const max = Math.min(READ_MAX_LINES, Math.max(1, Math.trunc(limit) || READ_MAX_LINES))
  if (totalLines === 0 || start > totalLines) {
    return {
      content: '',
      startLine: start,
      endLine: start - 1,
      totalLines,
      truncated: false,
      lineTruncated: false,
    }
  }
  const selected: string[] = []
  let bytes = 0
  let lineTruncated = false
  let index = start - 1
  while (index < totalLines && selected.length < max) {
    let line = lines[index]
    if (line.length > READ_MAX_LINE_CHARS) {
      line = line.slice(0, READ_MAX_LINE_CHARS) + LINE_TRUNCATED_SUFFIX
      lineTruncated = true
    }
    const size = utf8ByteLength(line) + (selected.length === 0 ? 0 : 1)
    if (selected.length > 0 && bytes + size > READ_MAX_BYTES) {
      break
    }
    selected.push(line)
    bytes += size
    index += 1
  }
  const endLine = start + selected.length - 1
  return {
    content: selected.join('\n'),
    startLine: start,
    endLine,
    totalLines,
    truncated: endLine < totalLines,
    lineTruncated,
  }
}

/** 快照截断：按行累计到上限，首行即超限时按码点截断，避免半个 UTF-8 字符或代理对 */
export const truncateToBytes = (
  text: string,
  maxBytes: number
): { content: string; truncated: boolean } => {
  if (utf8ByteLength(text) <= maxBytes) {
    return { content: text, truncated: false }
  }
  const normalized = normalizeText(text)
  const lines = normalized.split('\n')
  let output = ''
  let bytes = 0
  for (const line of lines) {
    const size = utf8ByteLength(line) + (output ? 1 : 0)
    if (bytes + size > maxBytes) {
      break
    }
    output += (output ? '\n' : '') + line
    bytes += size
  }
  if (!output) {
    let used = 0
    for (const char of normalized) {
      const size = utf8ByteLength(char)
      if (used + size > maxBytes) {
        break
      }
      output += char
      used += size
    }
  }
  return { content: output, truncated: true }
}
