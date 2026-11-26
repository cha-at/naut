import { ApiError } from '../api/client.js'
import { fetchWebPage, searchWeb } from '../api/webTools.js'
import type { ClientToolResultBlock, ClientToolUseBlock } from '../chat/types.js'
import { memoryService } from '../memory/index.js'
import {
  FILE_NAME_MAX,
  isMemoryFileName,
  memoryErrorCode,
  memoryErrorText,
} from '../memory/types.js'
import {
  formatEditResult,
  formatListResult,
  formatReadResult,
  formatWebFetchPage,
  formatWebSearchResults,
} from './format.js'
import { hasTool, isClientToolName, type Toolset } from './schemas.js'

/**
 * 客户端工具执行器：校验工具集与参数、执行记忆操作、把失败转成错误 tool_result。
 * 观察规则（edit 前必须先 read 额外文件）在这里判断，存储层只保证读改写原子性。
 */

/** 这些错误来自存储层，连续出现时由 agent loop 提前收尾 */
const STORAGE_ERROR_CODES = new Set([
  'not_found',
  'not_file',
  'invalid_path',
  'exists',
  'too_large',
  'too_many_files',
  'binary',
  'permission',
  'io',
  'no_backup',
  'backup_stale',
  'conflict',
  'root_unavailable',
])

export type ExecuteContext = {
  toolset: Toolset
  /** 本次回复内已经读到的文件（快照算作两份记忆文件已观察） */
  observed: Set<string>
  toolUseId: string
  signal?: AbortSignal
  /** 独立 Search / Fetch API 使用同一个 API Key */
  apiKey?: string
  /** 本轮用户问题，作为搜索的 ori_question 提升结果质量 */
  question?: string
}

export type ExecuteResult = {
  content: string
  isError: boolean
  display?: ClientToolResultBlock['display']
  storageError?: boolean
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const invalidToolInput = (): Parsed<never> => ({ ok: false, error: 'invalid tool input' })

const fail = (message: string): ExecuteResult => ({ content: `Error: ${message}`, isError: true })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 独立联网工具：只要开启了 search，就允许模型调用 web_search / web_fetch */
const SEARCH_TOOLS = new Set(['web_search', 'web_fetch'])

const isToolEnabled = (toolset: Toolset, name: string): boolean =>
  SEARCH_TOOLS.has(name) ? hasTool(toolset, 'search') : isClientToolName(name) && hasTool(toolset, name)

const isInteger = (value: unknown, min: number, max?: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= min &&
  (max === undefined || value <= max)

const hasOnlyKeys = (input: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(input).every((key) => allowed.includes(key))

/**
 * 记忆目录内的单个文件名：拒绝绝对路径、子目录、点开头、控制字符与超长名称。
 * 存储层仍会再校验一次，这里提前给出稳定的英文错误。
 */
const checkFileName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const name = value.trim()
  if (!name || name.length > FILE_NAME_MAX) {
    return null
  }
  if (name === '.' || name === '..' || name.startsWith('.')) {
    return null
  }
  if (/[\\/]/.test(name) || /^[a-zA-Z]:/.test(name)) {
    return null
  }
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) {
      return null
    }
  }
  return name
}

const parseListInput = (input: unknown): Parsed<null> => {
  if (!isRecord(input) || !hasOnlyKeys(input, [])) {
    return invalidToolInput()
  }
  return { ok: true, value: null }
}

const parseReadInput = (
  input: unknown
): Parsed<{ name: string; offset?: number; limit?: number }> => {
  if (!isRecord(input) || !hasOnlyKeys(input, ['file_path', 'offset', 'limit'])) {
    return invalidToolInput()
  }
  const name = checkFileName(input.file_path)
  if (!name) {
    return { ok: false, error: 'file_path must be a file name inside the memory directory' }
  }
  const { offset, limit } = input
  if (offset !== undefined && !isInteger(offset, 1)) {
    return { ok: false, error: 'offset must be an integer greater than or equal to 1' }
  }
  if (limit !== undefined && !isInteger(limit, 1, 2000)) {
    return { ok: false, error: 'limit must be an integer between 1 and 2000' }
  }
  return {
    ok: true,
    value: {
      name,
      offset: offset as number | undefined,
      limit: limit as number | undefined,
    },
  }
}

const parseWebSearchInput = (
  input: unknown
): Parsed<{ query: string; count?: number }> => {
  if (!isRecord(input) || !hasOnlyKeys(input, ['query', 'count'])) {
    return invalidToolInput()
  }
  if (typeof input.query !== 'string') {
    return invalidToolInput()
  }
  const query = input.query.trim()
  if (!query || query.length > 128) {
    return { ok: false, error: 'query must be 1-128 characters' }
  }
  if (input.count !== undefined && !isInteger(input.count, 1, 20)) {
    return { ok: false, error: 'count must be an integer between 1 and 20' }
  }
  return { ok: true, value: { query, count: input.count as number | undefined } }
}

const parseWebFetchInput = (input: unknown): Parsed<{ url: string }> => {
  if (!isRecord(input) || !hasOnlyKeys(input, ['url'])) {
    return invalidToolInput()
  }
  const { url } = input
  if (typeof url !== 'string' || !url || url.length > 8192) {
    return { ok: false, error: 'url must be an HTTP or HTTPS URL' }
  }
  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return { ok: false, error: 'url must be an HTTP or HTTPS URL without credentials' }
    }
  } catch {
    return { ok: false, error: 'url must be an HTTP or HTTPS URL' }
  }
  return { ok: true, value: { url } }
}

const parseEditInput = (
  input: unknown
): Parsed<{ name: string; oldString: string; newString: string; replaceAll: boolean }> => {
  if (!isRecord(input) || !hasOnlyKeys(input, ['file_path', 'old_string', 'new_string', 'replace_all'])) {
    return invalidToolInput()
  }
  const name = checkFileName(input.file_path)
  if (!name) {
    return { ok: false, error: 'file_path must be a file name inside the memory directory' }
  }
  const { old_string: oldString, new_string: newString, replace_all: replaceAll } = input
  if (typeof oldString !== 'string' || oldString === '') {
    return { ok: false, error: 'old_string must not be empty' }
  }
  if (typeof newString !== 'string') {
    return invalidToolInput()
  }
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') {
    return invalidToolInput()
  }
  return {
    ok: true,
    value: { name, oldString, newString, replaceAll: replaceAll === true },
  }
}

/** 联网工具失败：API 错误信息直接返回给模型，不参与存储失败计数 */
const webFailure = (error: unknown): ExecuteResult => {
  if (error instanceof ApiError) {
    return fail(error.message || `web request failed (${error.status ?? 'network'})`)
  }
  return fail(error instanceof Error ? error.message : 'web request failed')
}

const previewOf = (content: string): string =>
  content.split('\n').slice(0, 20).join('\n').slice(0, 2000)

const failure = (error: unknown): ExecuteResult => {
  const code = memoryErrorCode(error)
  return {
    content: `Error: ${memoryErrorText(error)}`,
    isError: true,
    storageError: STORAGE_ERROR_CODES.has(code),
  }
}

/** 编辑成功后重新读一次行数，用于结果文本；读取失败不影响编辑结果 */
const countLines = async (name: string): Promise<number | undefined> => {
  try {
    const info = await memoryService.read(name, 1, 1)
    return info.totalLines
  } catch {
    return undefined
  }
}

export const executeTool = async (
  block: ClientToolUseBlock,
  context: ExecuteContext
): Promise<ExecuteResult> => {
  // 流式解析阶段 JSON 非法：仍为该 tool_use_id 返回错误结果
  if (block.invalid) {
    return fail('invalid tool input')
  }
  if (!isToolEnabled(context.toolset, block.name)) {
    return fail('tool not enabled')
  }

  if (block.name === 'list') {
    const parsed = parseListInput(block.input)
    if (!parsed.ok) {
      return fail(parsed.error)
    }
    try {
      const list = await memoryService.list()
      return {
        content: formatListResult(list),
        isError: false,
        display: { entries: list.entries, truncated: list.truncated },
      }
    } catch (error) {
      return failure(error)
    }
  }

  if (block.name === 'read') {
    const parsed = parseReadInput(block.input)
    if (!parsed.ok) {
      return fail(parsed.error)
    }
    try {
      const result = await memoryService.read(
        parsed.value.name,
        parsed.value.offset ?? 1,
        parsed.value.limit
      )
      // 成功读取才加入观察集合
      context.observed.add(parsed.value.name)
      return {
        content: formatReadResult(result),
        isError: false,
        display: {
          file: parsed.value.name,
          lines: Math.max(0, result.endLine - result.startLine + 1),
          totalLines: result.totalLines,
          startLine: result.startLine,
          // 卡片最多展示 50 行
          preview: result.content.split('\n').slice(0, 50).join('\n'),
        },
      }
    } catch (error) {
      return failure(error)
    }
  }

  if (block.name === 'web_search') {
    const parsed = parseWebSearchInput(block.input)
    if (!parsed.ok) {
      return fail(parsed.error)
    }
    if (!context.apiKey) {
      return fail('missing API key')
    }
    try {
      const results = await searchWeb(context.apiKey, {
        query: parsed.value.query,
        count: parsed.value.count,
        oriQuestion: context.question,
        signal: context.signal,
      })
      const formatted = formatWebSearchResults(parsed.value.query, results)
      return {
        content: formatted.text,
        isError: false,
        display: {
          query: parsed.value.query,
          results: results.map((item) => ({
            title: item.title,
            url: item.url,
            date: item.date,
          })),
          truncated: formatted.truncated,
        },
      }
    } catch (error) {
      return webFailure(error)
    }
  }

  if (block.name === 'web_fetch') {
    const parsed = parseWebFetchInput(block.input)
    if (!parsed.ok) {
      return fail(parsed.error)
    }
    if (!context.apiKey) {
      return fail('missing API key')
    }
    try {
      const page = await fetchWebPage(context.apiKey, parsed.value.url, context.signal)
      const formatted = formatWebFetchPage(parsed.value.url, page)
      return {
        content: formatted.text,
        isError: false,
        display: {
          url: parsed.value.url,
          title: page.title,
          preview: previewOf(page.content),
          truncated: formatted.truncated,
        },
      }
    } catch (error) {
      return webFailure(error)
    }
  }

  const parsed = parseEditInput(block.input)
  if (!parsed.ok) {
    return fail(parsed.error)
  }
  const { name, oldString, newString, replaceAll } = parsed.value
  // 两份记忆文件由快照视为已观察；额外文件必须在同一条回复内先成功 read
  if (!isMemoryFileName(name) && !context.observed.has(name)) {
    return fail('read the file before editing')
  }
  try {
    const outcome = await memoryService.edit(
      name,
      oldString,
      newString,
      replaceAll,
      context.toolUseId,
      context.signal
    )
    context.observed.add(name)
    return {
      content: formatEditResult(name, outcome, await countLines(name)),
      isError: false,
      display: {
        file: name,
        replacements: outcome.replacements,
        backupId: outcome.backupId,
        // 卡片只展示对照片段，限制保存体积
        oldString: oldString.slice(0, 400),
        newString: newString.slice(0, 400),
      },
    }
  } catch (error) {
    return failure(error)
  }
}
