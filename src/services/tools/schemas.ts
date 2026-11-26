import { API_ORIGIN } from '../api/origin.js'
import type { ToolCapabilities } from '../settings.js'

/**
 * 客户端工具声明与工具集构造。
 * 声明对象不传 type：DeepSeek Anthropic 兼容接口按 { name, description, input_schema } 识别客户端工具。
 * 顺序固定为 list、read、edit、search，与写入回复的 toolset 一致。
 */

export type ClientToolName = 'list' | 'read' | 'edit' | 'web_search' | 'web_fetch'
export type ToolName = ClientToolName | 'search'
export type Toolset = ToolName[]

/** 联网工具来源：优先用内置服务端工具；接口不接受组合时改用独立 Search / Fetch API */
export type SearchMode = 'server' | 'client'

export type ToolInputProperty = {
  type: 'string' | 'integer' | 'boolean'
  description?: string
  minimum?: number
  maximum?: number
  minLength?: number
}

export type ToolInputSchema = {
  type: 'object'
  properties: Record<string, ToolInputProperty>
  required?: string[]
  additionalProperties: false
}

export type ClientToolDeclaration = {
  name: ClientToolName
  description: string
  input_schema: ToolInputSchema
}

export type ServerToolDeclaration =
  | { type: 'deepseek_web_search'; name: 'deepseek_web_search' }
  | { type: 'deepseek_read_url'; name: 'deepseek_read_url' }

export type ToolDeclaration = ClientToolDeclaration | ServerToolDeclaration

export const listTool: ClientToolDeclaration = {
  name: 'list',
  description:
    'List files in the memory directory. Returns name, size and last modified time. ' +
    'USER.md and MEMORY.md are the two memory files automatically included in the system prompt. ' +
    'Directories, hidden files and symlinks are skipped.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

export const readTool: ClientToolDeclaration = {
  name: 'read',
  description:
    'Read a UTF-8 text file from the memory directory. Returns line-numbered content; ' +
    'the line number prefix is not part of the file. Use offset and limit for long files. ' +
    'Only flat file names inside the memory directory are allowed.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Relative file name, e.g. USER.md or notes.md' },
      offset: { type: 'integer', minimum: 1, description: '1-based first line to return' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 2000,
        description: 'Maximum number of lines to return (default 2000)',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  },
}

export const editTool: ClientToolDeclaration = {
  name: 'edit',
  description:
    'Edit a UTF-8 text file in the memory directory by replacing literal text. ' +
    'old_string must match exactly and must be unique unless replace_all is true. ' +
    'Do not include line numbers from read output in old_string. ' +
    'Read a file before editing it unless it is USER.md or MEMORY.md (already in the system prompt).',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Relative file name inside the memory directory' },
      old_string: { type: 'string', minLength: 1, description: 'Exact literal text to replace' },
      new_string: {
        type: 'string',
        description: 'Replacement text; empty string deletes the match',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence instead of requiring a unique match',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
}

export const webSearchTool: ClientToolDeclaration = {
  name: 'web_search',
  description:
    'Search the web and return a ranked list of pages with title, URL, publication date and a summary. ' +
    'Use it for current events, prices, releases or anything that may have changed recently. ' +
    'Supports operators such as site:, -site:, "exact phrase", lang:zh,en, after:2025 and before:2026.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        description: 'Search query, 1–128 characters; supports site:, "phrase", after: and before: operators',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Number of results to return (default 8)',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

export const webFetchTool: ClientToolDeclaration = {
  name: 'web_fetch',
  description:
    'Fetch a web page and return its title and Markdown content (up to 32 KiB). ' +
    'Use it to read a page from web_search results or a link the user sent.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        description: 'HTTP or HTTPS URL without username or password',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
}

const CLIENT_TOOLS: Record<ClientToolName, ClientToolDeclaration> = {
  list: listTool,
  read: readTool,
  edit: editTool,
  web_search: webSearchTool,
  web_fetch: webFetchTool,
}

const WEB_SEARCH_TOOL: ServerToolDeclaration = {
  type: 'deepseek_web_search',
  name: 'deepseek_web_search',
}

const READ_URL_TOOL: ServerToolDeclaration = {
  type: 'deepseek_read_url',
  name: 'deepseek_read_url',
}

export const clientToolDeclaration = (name: ClientToolName): ClientToolDeclaration =>
  CLIENT_TOOLS[name]

export const isClientToolName = (name: string): name is ClientToolName =>
  Object.hasOwn(CLIENT_TOOLS, name)

/** 回复里是否声明了客户端工具；只有联网工具时不算 */
export const hasClientTools = (toolset: Toolset | undefined): boolean =>
  Boolean(toolset?.some((tool) => tool !== 'search'))

export const hasTool = (toolset: Toolset | undefined, name: ToolName): boolean =>
  Boolean(toolset?.includes(name))

/**
 * 按工具集生成请求里的 tools：
 * - searchMode 为 server 时声明内置联网工具；
 * - 为 client 时声明 web_search / web_fetch 两个客户端工具（接口不支持组合时的兜底）。
 */
export const buildTools = (
  toolset: Toolset,
  searchMode: SearchMode = 'server'
): ToolDeclaration[] =>
  toolset.flatMap((tool): ToolDeclaration[] => {
    if (tool === 'search') {
      return searchMode === 'client' ? [webSearchTool, webFetchTool] : [WEB_SEARCH_TOOL, READ_URL_TOOL]
    }
    return [clientToolDeclaration(tool)]
  })

/**
 * 联网工具来源：工具集里同时存在客户端工具且已记录「不支持组合」时，
 * 改用独立的 Search / Fetch API；只声明联网工具时仍用内置工具。
 */
export const searchModeFor = (
  toolset: Toolset,
  capabilities: ToolCapabilities
): SearchMode =>
  hasClientTools(toolset) && isServerWebToolsDegraded(capabilities) ? 'client' : 'server'

/** 兼容性降级：保留客户端工具，去掉联网工具，本回复的 toolset 同步去掉 search */
export const withoutSearch = (toolset: Toolset): Toolset =>
  toolset.filter((tool) => tool !== 'search')

/**
 * 接口不支持「客户端工具 + 服务端联网工具」时，只有同一 API 源写入的标记才生效；
 * 换了 API 源后重新尝试组合，避免永久降级。
 */
export const isServerWebToolsDegraded = (capabilities: ToolCapabilities): boolean =>
  capabilities.serverWebToolsWithClientTools === false &&
  (!capabilities.apiOrigin || capabilities.apiOrigin === API_ORIGIN)

export type ToolSettings = {
  toolsEnabled: boolean
  toolRead: boolean
  toolEdit: boolean
  toolSearch: boolean
  toolCapabilities: ToolCapabilities
}

/**
 * 工具集构造：总开关关闭时为空；list 随 read 启用；
 * 已记录「不能同时使用客户端工具与联网工具」时，只有 read/edit 都关闭才声明 search。
 */
export const buildToolset = (settings: ToolSettings): Toolset => {
  if (!settings.toolsEnabled) {
    return []
  }
  const toolset: Toolset = []
  if (settings.toolRead) {
    toolset.push('list', 'read')
  }
  if (settings.toolEdit) {
    toolset.push('edit')
  }
  // 联网能力始终按用户开关记录；不支持组合时由 searchModeFor 改用独立接口声明
  if (settings.toolSearch) {
    toolset.push('search')
  }
  return toolset
}

/** 单个工具是否可用：list 需要 read 开启，search 需要联网开关 */
export const toggledToolset = (settings: ToolSettings): Toolset => buildToolset(settings)
