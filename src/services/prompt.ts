import type { PersonaSnapshot } from './chat/types.js'
import type { MemorySnapshot } from './memory/types.js'
import type { SearchMode, Toolset } from './tools/schemas.js'

/**
 * 系统提示词：基础身份 + 当前人格 + 工具说明 + 两份记忆快照。
 * 顺序固定：人格在前、工具规则在后，工具规则用于约束能力边界；人格设定不能改变工具权限。
 */

/** 所有生成请求统一携带的助手身份说明 */
export const BASE_IDENTITY = '该助手为DeepSeek，由深度求索公司创造。'

export const TRUNCATION_NOTE = '（内容已截断，使用 read 工具查看完整内容）'

const EMPTY_PERSONA_PROMPT = '（未设置人格设定）'
const EMPTY_MEMORY = '（空）'

const INSTRUCTIONS = {
  intro:
    'The files below live on the user device in a flat memory directory. Do not invent file contents and do not claim to read anything you were not given; use only the tools listed here.',
  list:
    'list() — List the files in the memory directory with name, size and last modified time. USER.md and MEMORY.md are the two memory files; snapshots of both are included below. Other files exist only in that directory.',
  read:
    'read(file_path, offset?, limit?) — Read a UTF-8 text file from the memory directory. The returned text is prefixed with line numbers ("N: ") that are not part of the file; never copy them into edits. Use offset and limit to page through long files.',
  edit:
    'edit(file_path, old_string, new_string, replace_all?) — Replace literal text in a file that already exists. old_string must match exactly and must be unique unless replace_all is true; an empty new_string deletes the match. Read a file before editing it, except USER.md and MEMORY.md whose snapshots are already included. The edit is applied immediately and the app keeps one undo per file.',
  search:
    'Smart search — Search the web and read links the user sends whenever the answer needs current or external information.',
  clientSearch:
    'web_search(query, count?) — Search the web and get a ranked list of pages with title, URL, publication date and a summary. Use it whenever the answer depends on current events, prices, releases or anything that may have changed recently. web_fetch(url) — Read a web page as Markdown (up to 32 KiB); use it on a promising search result or a link the user sent. Cite the URLs you used.',
  snapshot:
    'The two memory snapshots below were captured when this conversation started. If the user changed the files after that, use read to get the latest content before editing.',
  memoryPolicy:
    'Only store durable preferences and facts the user stated explicitly. Do not store secrets, credentials or sensitive personal data; ask the user when unsure.',
}

export type PromptInput = {
  persona: PersonaSnapshot
  memory: MemorySnapshot
  toolset: Toolset
  /** 联网工具来源：内置服务端工具或独立 Search / Fetch API */
  searchMode?: SearchMode
}

/**
 * 只描述本次实际声明的工具；未声明的工具不出现在说明里。
 * 没有工具时返回空串，由调用方省略整个区块。
 */
export const buildToolInstructions = (
  toolset: Toolset,
  searchMode: SearchMode = 'server'
): string => {
  if (toolset.length === 0) {
    return ''
  }
  const tools = new Set(toolset)
  const lines = [INSTRUCTIONS.intro]
  if (tools.has('list')) {
    lines.push(INSTRUCTIONS.list)
  }
  if (tools.has('read')) {
    lines.push(INSTRUCTIONS.read)
  }
  if (tools.has('edit')) {
    lines.push(INSTRUCTIONS.edit)
  }
  if (tools.has('search')) {
    lines.push(searchMode === 'client' ? INSTRUCTIONS.clientSearch : INSTRUCTIONS.search)
  }
  if (tools.has('read')) {
    lines.push(INSTRUCTIONS.snapshot)
  }
  if (tools.has('edit')) {
    lines.push(INSTRUCTIONS.memoryPolicy)
  }
  return lines.join('\n')
}

const memorySection = (
  title: string,
  snapshot: string | undefined,
  truncated: boolean | undefined
): string => {
  const body = snapshot || EMPTY_MEMORY
  return `${title}\n${body}${truncated ? `\n\n${TRUNCATION_NOTE}` : ''}`
}

export const buildSystemPrompt = ({
  persona,
  memory,
  toolset,
  searchMode = 'server',
}: PromptInput): string => {
  const sections: string[] = [BASE_IDENTITY]
  sections.push(
    `## 当前人格\n${persona.name}\n${persona.prompt || EMPTY_PERSONA_PROMPT}`
  )
  const toolText = buildToolInstructions(toolset, searchMode)
  if (toolText) {
    sections.push(`## 记忆与工具\n${toolText}`)
  }
  sections.push(memorySection('## 用户记忆（USER.md）', memory.user, memory.userTruncated))
  sections.push(memorySection('## 长期记忆（MEMORY.md）', memory.memory, memory.memoryTruncated))
  return sections.join('\n\n')
}
