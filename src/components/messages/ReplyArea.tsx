import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconBrowseOutline16,
  IconBrowseWarningOutline16,
  IconCheck20,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseFill14,
  IconLinkOutline16,
  IconRightUpOutline14,
  IconSearchOutline16,
  IconSearchWarningOutline16,
} from '../base/icons.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import {
  getAreaTitle,
  isDeepSearchKind,
  isImageSearchKind,
  type FindStep,
  type OpenStep,
  type PageItem,
  type ReadLinkStep,
  type ReplyView,
  type SearchStep,
  type Source,
  type Step,
} from '../../services/chat/view.js'
import { Tooltip } from '../base/Tooltip.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { ToolCallCard } from './ToolCallCard.js'
import styles from './ReplyArea.module.css'
import './thinking.markdown.css'

/** 进行中时每秒刷新，用于思考用时与搜索词轮播 */
const useTicker = (active: boolean, interval: number) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), interval)
    return () => clearInterval(timer)
  }, [active, interval])
  return tick
}

/**
 * 思考与工具步骤：官方那种「已思考（用时 N 秒）>」的一行标题 + 可展开的时间线。
 * 流式期间默认展开，回答结束后自动收起；用户手动点开 / 收起后不再自动改。
 */
export const ReplyArea = memo(function ReplyArea({
  message,
  view,
  streaming,
  hasResponse,
}: {
  message: AssistantMessage
  view: ReplyView
  streaming: boolean
  hasResponse: boolean
}) {
  useTranslate()
  const [open, setOpen] = useState(() => streaming || !hasResponse)
  const wasStreaming = useRef(streaming)
  const titleActive = streaming && !hasResponse
  useTicker(titleActive, 1000)

  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      setOpen(false)
    }
    wasStreaming.current = streaming
  }, [streaming])

  if (view.steps.length === 0 && !(message.thinking && streaming)) {
    return null
  }
  // 未记录请求开关时，按是否有思考内容显示标题。
  const thinking = message.thinking ?? view.steps.some((step) => step.type === 'thinking')
  const title = thinking ? getAreaTitle(view, streaming, Date.now(), hasResponse) : null
  return (
    <div className={styles.area}>
      {title ? (
        <button
          type="button"
          className={styles.title}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={clsx(styles.titleText, titleActive && styles.shimmer)}>{title}</span>
          <span className={styles.chevron}>
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        </button>
      ) : null}
      {open || !title ? (
        <div className={styles.steps}>
          {view.steps.map((step, index) => (
            <StepItem
              key={stepKey(step, index)}
              step={step}
              message={message}
              sources={view.sources}
              streaming={streaming}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})

const stepKey = (step: Step, index: number) =>
  step.type === 'thinking' ||
  step.type === 'text' ||
  step.type === 'search' ||
  step.type === 'list' ||
  step.type === 'read' ||
  step.type === 'edit' ||
  step.type === 'web_search' ||
  step.type === 'web_fetch' ||
  step.type === 'tool_error'
    ? step.key
    : `${step.type}-${index}`

const StepItem = ({
  step,
  message,
  sources,
  streaming,
}: {
  step: Step
  message: AssistantMessage
  sources: Source[]
  streaming: boolean
}) => {
  switch (step.type) {
    case 'thinking': {
      const lastBlock = step.blocks.at(-1)
      const thinking =
        streaming && lastBlock?.startedAt !== undefined && lastBlock.endedAt === undefined
      return (
        <div className={styles.content}>
          <Markdown
            content={step.blocks.map((block) => block.thinking).join('')}
            loading={thinking}
            cacheKey={`${message.id}-${step.key}`}
            disableLink
          />
        </div>
      )
    }
    case 'text':
      return (
        <div className={styles.content}>
          <Markdown
            content={step.markdown}
            loading={streaming}
            cacheKey={`${message.id}-${step.key}`}
            disableLink={false}
            sources={sources}
          />
        </div>
      )
    case 'search':
      return <SearchRow step={step} message={message} streaming={streaming} />
    case 'open':
      return <OpenRow step={step} sources={sources} />
    case 'find':
      return <FindRow step={step} />
    case 'read_link':
      return <ReadLinkRow step={step} />
    case 'list':
    case 'read':
    case 'edit':
    case 'web_search':
    case 'web_fetch':
    case 'tool_error':
      return <ToolCallCard step={step} message={message} />
    default:
      return null
  }
}

/** 搜索：普通搜索为「已阅读 N 个网页」，边想边搜为「搜索到 N 个网页」，点击打开搜索结果 */
const SearchRow = ({
  step,
  message,
  streaming,
}: {
  step: SearchStep
  message: AssistantMessage
  streaming: boolean
}) => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const wip = step.status === 'wip'
  const tick = useTicker(wip && step.queries.length > 1, 2000)
  const count = step.results.length
  const clickable = !wip && count > 0
  const panelEntry = `${message.id}-search-${step.key}`
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  let body: ReactNode
  if (wip) {
    body =
      step.queries.length > 0 ? (
        <>
          <span className={styles.prefix}>{t('toolSearchIntro')}</span>
          <span className={styles.query} key={tick}>
            {step.queries[tick % step.queries.length]}
          </span>
        </>
      ) : (
        <span>{t(isImageSearchKind(step.kind) ? 'imageSearching' : 'messageSearching')}</span>
      )
  } else if (interrupted) {
    body = <span>{t('searchStopped')}</span>
  } else if (failed) {
    body = <span>{t('toolSearchFail')}</span>
  } else if (count === 0) {
    body = (
      <span>{t(isDeepSearchKind(step.kind) ? 'toolSearchNoResult' : 'messageSearchNoResult')}</span>
    )
  } else {
    const text = t(
      isDeepSearchKind(step.kind)
        ? count === 1
          ? 'toolSearch1Result'
          : 'toolSearchResults'
        : count === 1
          ? 'messageSearchResult'
          : 'messageSearchResults',
      { count }
    )
    body = (
      <>
        <span className={styles.summary}>{text}</span>
        <SiteThumbnails sources={step.results} />
      </>
    )
  }
  return (
    <div
      className={clsx(
        styles.row,
        clickable && styles.clickable,
        entry === panelEntry && styles.active
      )}
      onClick={clickable ? () => toggleSearchPanel(panelEntry, step.results) : undefined}
    >
      <span className={styles.rowIcon}>
        {failed ? <IconSearchWarningOutline16 /> : <IconSearchOutline16 />}
      </span>
      <span className={styles.rowBody}>{body}</span>
    </div>
  )
}

/** 工具行外壳：左侧图标，右侧可换行的内容 */
const ToolRow = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <div className={styles.tool}>
    <span className={styles.rowIcon}>{icon}</span>
    <div className={styles.toolBody}>{children}</div>
  </div>
)

const PageLink = ({ page, failedTip }: { page: PageItem; failedTip?: string }) => (
  <span
    className={clsx(
      styles.page,
      page.status === 'failed' || !page.url ? styles.pageFailed : styles.pageDone
    )}
  >
    {page.status === 'failed' ? (
      <Tooltip content={failedTip}>
        <span className={styles.pageText}>{page.title}</span>
      </Tooltip>
    ) : (
      <a className={styles.pageText} href={page.url} target="_blank" rel="noreferrer">
        {page.title}
      </a>
    )}
    <span className={styles.pageIcon}>
      <IconRightUpOutline14 />
    </span>
  </span>
)

/** 边想边搜打开的网页：「浏览 N 个页面」+ 最多 5 个页面 */
const OpenRow = ({ step, sources }: { step: OpenStep; sources: Source[] }) => {
  const t = useTranslate()
  const allFailed = step.pages.every((page) => page.status === 'failed')
  const count = step.pages.length
  const intro = t(count === 1 ? 'toolOpenOneIntro' : 'toolOpensIntro', { count })
  const panelEntry = `open-${step.pages[0]?.id}`
  return (
    <ToolRow icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}>
      {allFailed ? (
        t('toolOpenFail')
      ) : (
        <>
          <span className={styles.intro}>{intro}</span>
          {step.pages.slice(0, 5).map((page) => (
            <PageLink key={page.id} page={page} failedTip={t('toolOpenFailTooltip')} />
          ))}
          {count > 5 ? (
            <span
              className={styles.chip}
              onClick={() =>
                toggleSearchPanel(
                  panelEntry,
                  sources.filter((source) => step.pages.some((page) => page.url === source.url))
                )
              }
            >
              {t('toolOpenViewAll')}
            </span>
          ) : null}
        </>
      )}
    </ToolRow>
  )
}

/** 边想边搜的页内查找：「查找关键词」+ 关键词标签 */
const FindRow = ({ step }: { step: FindStep }) => {
  const t = useTranslate()
  const allFailed = step.patterns.every((item) => item.status === 'failed')
  return (
    <ToolRow icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}>
      {allFailed ? (
        t('toolFindFail')
      ) : (
        <>
          <span className={styles.intro}>{t('toolFindIntro')}</span>
          {step.patterns.map((item) => (
            <Tooltip
              key={item.id}
              content={item.status === 'failed' ? t('toolFindFailTooltip') : null}
            >
              <span className={clsx(styles.chip, item.status === 'failed' && styles.chipFailed)}>
                {item.status === 'wip' ? null : (
                  <span className={styles.chipIcon}>
                    {item.status === 'failed' ? <IconCloseFill14 /> : <IconCheck20 />}
                  </span>
                )}
                <span className={styles.chipText}>{item.pattern}</span>
              </span>
            </Tooltip>
          ))}
        </>
      )}
    </ToolRow>
  )
}

/** 阅读用户消息中的链接：视图只保留仍在读取的链接。 */
const ReadLinkRow = ({ step }: { step: ReadLinkStep }) => {
  const t = useTranslate()
  return (
    <ToolRow icon={<IconLinkOutline16 />}>
      <span className={clsx(styles.intro, styles.shimmer)}>{t('readingLink')}</span>
      {step.links.map((link) => (
        <PageLink key={link.id} page={link} />
      ))}
    </ToolRow>
  )
}
