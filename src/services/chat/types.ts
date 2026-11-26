import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'
import type { MemorySnapshot } from '../memory/types.js'
import type { Toolset } from '../tools/schemas.js'

/** 会话首条消息前捕获的人格快照；人格之后被编辑或删除都不影响该会话 */
export type PersonaSnapshot = { id: string; name: string; prompt: string }

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  /** 当前 serverId 对应的上传图片已确认符合长边限制。旧记录缺少此字段。 */
  imageSizeChecked?: boolean
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  createdAt: number
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 客户端工具调用：input 由 input_json_delta 拼出；流式期间的临时字段落盘前删除 */
export type ClientToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
  /** 仅流式解析期使用 */
  inputJson?: string
  /** 仅流式解析期使用：JSON 非法 */
  invalid?: boolean
}

/** 客户端工具结果：内容按 tool_use_id 回传给模型；display 仅供界面与撤销使用 */
export type ClientToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  isError?: boolean
  display?: {
    file?: string
    lines?: number
    totalLines?: number
    replacements?: number
    backupId?: string
    /** read：窗口内原始文本，最多保留 50 行用于预览 */
    preview?: string
    startLine?: number
    /** list：本次列出的条目与截断标记 */
    entries?: { name: string; size: number; modifiedAt: number; isMemory: boolean }[]
    truncated?: boolean
    /** edit：对照片段，超长时截断保存 */
    oldString?: string
    newString?: string
    /** 联网搜索：查询词 */
    query?: string
    /** 联网搜索：结果条目（标题、链接、日期） */
    results?: { title: string; url: string; date: string | null }[]
    /** 联网抓取：页面标题（正文预览复用 preview） */
    title?: string
    /** 联网抓取：页面地址 */
    url?: string
  }
}

/** 服务端工具调用与结果块按协议原样保存；历史请求只回传 read_link 调用与结果 */
export type ReplyBlock =
  | ThinkingPart
  | TextPart
  | ServerToolBlock
  | ClientToolUseBlock
  | ClientToolResultBlock

/** 回复错误分类：upload 为发送前补传失败；tools / storage 为工具循环收尾 */
export type AssistantMessageErrorKind = ApiErrorKind | 'upload' | 'tools' | 'storage'

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 旧字段：请求时是否声明 deepseek_web_search；新回复用 tools / toolset */
  search?: boolean
  /** 请求时工具调用总开关；旧回复没有该字段 */
  tools?: boolean
  /** 本次回复实际声明给模型的工具集，降级后同步更新；旧回复没有该字段 */
  toolset?: Toolset
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  error?: {
    /** upload：发送前补传附件失败，请求没有发出；tools / storage：工具循环收尾 */
    kind: AssistantMessageErrorKind
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 置顶在会话列表顶部；旧数据没有该字段时按未置顶处理 */
  pinned?: boolean
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
  /** 会话首条消息前捕获的人格快照；旧会话与导入会话缺失，下次创建回复前补捕获 */
  personaSnapshot?: PersonaSnapshot
  /** 会话首条消息前捕获的两份记忆快照；缺失时下次创建回复前补捕获 */
  memorySnapshot?: MemorySnapshot
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<Session, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'pinned'>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
})
