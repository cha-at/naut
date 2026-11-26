import { truncateToBytes } from '../memory/text.js'
import {
  MEMORY_DIR_MAX_FILES,
  MEMORY_FILE_MAX_BYTES,
  READ_MAX_LINE_CHARS,
  type MemoryEditOutcome,
  type MemoryListResult,
  type MemoryReadResult,
} from '../memory/types.js'

/** 工具结果文本：稳定、简短、可被模型直接理解；不包含文件以外的内容 */

const pad = (value: number) => String(value).padStart(2, '0')

export const formatBytes = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) {
    return '0 bytes'
  }
  if (size < 1024) {
    return `${size} bytes`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** 本地时间 YYYY-MM-DD HH:MM，避免依赖运行环境的 locale */
export const formatTimestamp = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return 'unknown time'
  }
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

const readPagination = (result: MemoryReadResult): string => {
  const { startLine, endLine, totalLines, truncated, lineTruncated } = result
  const lines: string[] = []
  if (totalLines === 0 || startLine > totalLines) {
    lines.push(
      totalLines === 0
        ? '(The file is empty.)'
        : `(The file has ${totalLines} lines; offset ${startLine} is past the end. Use offset=1 to read from the beginning.)`
    )
  } else if (truncated) {
    lines.push(
      `(Showing lines ${startLine}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue.)`
    )
  } else {
    lines.push(`(Showing lines ${startLine}-${endLine} of ${totalLines}.)`)
  }
  if (lineTruncated) {
    lines.push(`(Some lines were truncated at ${READ_MAX_LINE_CHARS} characters.)`)
  }
  if (result.size > MEMORY_FILE_MAX_BYTES) {
    lines.push('(The file is larger than 64 KiB; edit will refuse to write it.)')
  }
  return lines.join('\n')
}

/** read 结果：带行号的正文 + 分页/截断说明；行号不属于文件内容 */
export const formatReadResult = (result: MemoryReadResult): string => {
  const body = result.content
    ? result.content
        .split('\n')
        .map((line, index) => `${result.startLine + index}: ${line}`)
        .join('\n')
    : ''
  const footer = readPagination(result)
  return body ? `${body}\n\n${footer}` : footer
}

const memoryRank = (name: string): number => (name === 'USER.md' ? 0 : name === 'MEMORY.md' ? 1 : 2)

/** list 结果：文件名、大小、修改时间；两份记忆文件固定在前并标注 */
export const formatListResult = (result: MemoryListResult): string => {
  if (result.entries.length === 0) {
    return 'The memory directory is empty.'
  }
  const entries = [...result.entries].sort(
    (a, b) => memoryRank(a.name) - memoryRank(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' })
  )
  const rows = entries.map((entry) => {
    const suffix = entry.isMemory ? ' [memory, auto-injected]' : ''
    return `${entry.name} — ${formatBytes(entry.size)} — ${formatTimestamp(entry.modifiedAt)}${suffix}`
  })
  const header = `Memory directory: ${entries.length} file${entries.length === 1 ? '' : 's'}`
  const footer = result.truncated
    ? `(Only the first ${MEMORY_DIR_MAX_FILES} files are shown.)`
    : ''
  return [header, ...rows, ...(footer ? [footer] : [])].join('\n')
}

/** 联网搜索与抓取的结果上限，避免单次工具结果撑大上下文 */
const WEB_SEARCH_MAX_BYTES = 16 * 1024
const WEB_FETCH_MAX_BYTES = 32 * 1024

type WebSearchItemLike = {
  title: string
  url: string
  snippet: string
  summary: string
  siteName: string | null
  date: string | null
}

const capText = (text: string, maxBytes: number): { text: string; truncated: boolean } => {
  if (new TextEncoder().encode(text).length <= maxBytes) {
    return { text, truncated: false }
  }
  const cut = truncateToBytes(text, maxBytes)
  return { text: `${cut.content}\n\n(Output truncated.)`, truncated: true }
}

/** 联网搜索结果：标题、链接、日期与摘要；结果较多时整体截断 */
export const formatWebSearchResults = (
  query: string,
  results: WebSearchItemLike[]
): { text: string; truncated: boolean } => {
  if (results.length === 0) {
    return { text: `No web results found for "${query}".`, truncated: false }
  }
  const blocks = results.map((item, index) => {
    const meta = [item.date, item.siteName].filter(Boolean).join(' · ')
    const summary = item.summary || item.snippet
    return [
      `${index + 1}. ${item.title}`,
      item.url,
      ...(meta ? [`(${meta})`] : []),
      ...(summary ? [summary] : []),
    ].join('\n')
  })
  const text = [
    `Web search results for "${query}" (${results.length}):`,
    ...blocks,
    'Use web_fetch with a URL to read a full page.',
  ].join('\n\n')
  return capText(text, WEB_SEARCH_MAX_BYTES)
}

/** 联网抓取：标题 + 网页 Markdown 正文，超过 32 KiB 截断并说明 */
export const formatWebFetchPage = (
  url: string,
  page: { title: string; content: string }
): { text: string; truncated: boolean } => {
  const body = truncateToBytes(page.content, WEB_FETCH_MAX_BYTES)
  const header = [page.title || url, `URL: ${url}`].join('\n')
  const note = body.truncated ? '\n\n(Content truncated at 32 KiB; open the URL for the full page.)' : ''
  return {
    text: `${header}\n\n${body.content}${note}`,
    truncated: body.truncated,
  }
}

/** edit 结果：文件名、替换处数与写入后的行数/字节数 */
export const formatEditResult = (
  name: string,
  outcome: Pick<MemoryEditOutcome, 'replacements' | 'entry'>,
  totalLines?: number
): string => {
  const shape = `${totalLines === undefined ? '' : `${totalLines} line${totalLines === 1 ? '' : 's'}, `}${formatBytes(outcome.entry.size)}`
  if (outcome.replacements === 0) {
    return `No changes to ${name} (${shape}).`
  }
  return `Edited ${name}: replaced ${outcome.replacements} occurrence${
    outcome.replacements === 1 ? '' : 's'
  } (${shape}).`
}
