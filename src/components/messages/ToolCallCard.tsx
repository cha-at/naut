import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import type {
  EditStep,
  ListStep,
  ReadStep,
  ToolErrorStep,
  ToolStatus,
  WebFetchStep,
  WebSearchStep,
} from '../../services/chat/view.js'
import { refreshMemoryUndo, undoMemoryEdit, useMemoryUndo } from '../../services/memory/memoryUndoState.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconFileText20,
  IconGlobeOutline16,
  IconListChecks20,
  IconPencil20,
  IconSearchOutline16,
  IconWarningOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { formatFileSize, formatFileTime } from '../personalization/format.js'
import styles from './ToolCallCard.module.css'

type ToolStep = ListStep | ReadStep | EditStep | WebSearchStep | WebFetchStep | ToolErrorStep

const MAX_PREVIEW_LINES = 50
const MAX_DIFF_LINES = 20

const truncateLines = (text: string, limit: number): string => {
  const lines = text.split('\n')
  return lines.length <= limit ? text : `${lines.slice(0, limit).join('\n')}\n…`
}

const titleOf = (
  step: ToolStep,
  t: ReturnType<typeof useTranslate>
): { title: string; summary?: string } => {
  if (step.type === 'list') {
    return {
      title:
        step.status === 'wip'
          ? t('toolCallListTitle')
          : t('toolCallListCount', { count: step.entries.length }),
    }
  }
  if (step.type === 'read') {
    return {
      title: t('toolCallReadTitle', { file: step.file ?? '' }),
      summary: step.totalLines === undefined ? undefined : t('toolCallReadLines', { count: step.totalLines }),
    }
  }
  if (step.type === 'edit') {
    return {
      title: t('toolCallEditTitle', { file: step.file ?? '' }),
      summary:
        step.replacements === undefined
          ? undefined
          : t('toolCallEditCount', { count: step.replacements }),
    }
  }
  if (step.type === 'web_search') {
    return {
      title: t('toolCallWebSearchTitle'),
      summary:
        step.status === 'done'
          ? t('toolCallWebSearchCount', { count: step.results.length })
          : undefined,
    }
  }
  if (step.type === 'web_fetch') {
    return { title: t('toolCallWebFetchTitle'), summary: step.title || step.url }
  }
  return { title: step.name, summary: t('toolCallFailed') }
}

/** 记忆工具卡片：进行中 / 成功 / 失败，展开后显示条目、预览或对照片段 */
export const ToolCallCard = ({
  step,
  message,
}: {
  step: ToolStep
  message: AssistantMessage
}) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const status: ToolStatus = step.type === 'tool_error' ? 'failed' : step.status
  const [open, setOpen] = useState(status !== 'done')
  const [undone, setUndone] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const file = step.type === 'read' || step.type === 'edit' ? step.file : undefined
  const backupId = step.type === 'edit' ? step.backupId : undefined
  const entry = useMemoryUndo((state) => (file ? state.entries[file] : undefined))

  // 成功编辑但本地还没有备份状态时查询一次，用于显示撤销入口
  useEffect(() => {
    if (file && step.type === 'edit' && status === 'done' && backupId && !entry) {
      void refreshMemoryUndo(file)
    }
  }, [file, step.type, status, backupId, entry])

  const failed = status === 'failed'
  const wip = status === 'wip'
  const { title, summary: detail } = titleOf(step, t)
  // 失败时用统一摘要，展开后才是原始错误
  const summary = failed ? t('toolCallFailed') : detail
  const undoAvailable = Boolean(
    !undone && file && entry?.available && backupId && entry.backupId === backupId
  )

  const undo = async () => {
    if (!file) {
      return
    }
    setUndoing(true)
    const result = await undoMemoryEdit(file)
    setUndoing(false)
    if (result.ok) {
      setUndone(true)
      showToast({ key: 'memoryUndoSuccess' })
    } else {
      showToast({ key: result.error, type: 'error' })
    }
  }

  const icon = failed ? (
    <IconWarningOutline16 />
  ) : step.type === 'list' ? (
    <IconListChecks20 />
  ) : step.type === 'edit' ? (
    <IconPencil20 />
  ) : step.type === 'web_search' ? (
    <IconSearchOutline16 />
  ) : step.type === 'web_fetch' ? (
    <IconGlobeOutline16 />
  ) : (
    <IconFileText20 />
  )

  const body = () => {
    if (step.type === 'tool_error') {
      return <div className={styles.error}>{step.error || t('toolCallFailed')}</div>
    }
    if (failed) {
      return <div className={styles.error}>{step.error || t('toolCallFailed')}</div>
    }
    if (step.type === 'list') {
      return step.entries.length === 0 ? (
        <div className={styles.summary}>{t('toolCallListEmpty')}</div>
      ) : (
        <div className={styles.entries}>
          {step.entries.map((item) => (
            <div className={styles.entry} key={item.name}>
              <span className={styles.entryName}>
                <span>{item.name}</span>
                {item.isMemory ? <span className={styles.badge}>{t('memorySnapshotBadge')}</span> : null}
              </span>
              <span className={styles.entryMeta}>{formatFileSize(item.size)}</span>
              <span className={styles.entryMeta}>{formatFileTime(item.modifiedAt, locale)}</span>
            </div>
          ))}
          {step.truncated ? (
            <div className={styles.summary}>{t('toolCallListTruncated')}</div>
          ) : null}
        </div>
      )
    }
    if (step.type === 'read') {
      const start = step.startLine ?? 1
      const lines = (step.preview ?? '').split('\n').slice(0, MAX_PREVIEW_LINES)
      return (
        <>
          <pre className={styles.pre}>
            {lines.map((line, index) => `${start + index}: ${line}`).join('\n')}
          </pre>
          {step.totalLines !== undefined && step.totalLines > lines.length ? (
            <div className={styles.summary}>{t('toolCallReadTruncated')}</div>
          ) : null}
        </>
      )
    }
    if (step.type === 'web_search') {
      return (
        <>
          {step.query ? (
            <div className={styles.summary}>
              {t('toolCallWebSearchQuery', { query: step.query })}
            </div>
          ) : null}
          {step.results.length === 0 ? (
            <div className={styles.summary}>{t('toolCallWebSearchEmpty')}</div>
          ) : (
            <div className={styles.webResults}>
              {step.results.map((item) => (
                <div className={styles.webResult} key={item.url}>
                  <a
                    className={styles.webLink}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.title || item.url}
                  </a>
                  <span className={styles.webMeta}>
                    {item.url}
                    {item.date ? ` · ${item.date}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {step.truncated ? (
            <div className={styles.summary}>{t('toolCallReadTruncated')}</div>
          ) : null}
        </>
      )
    }
    if (step.type === 'web_fetch') {
      return (
        <>
          {step.url ? <div className={styles.summary}>{step.url}</div> : null}
          <pre className={styles.pre}>{step.preview ?? ''}</pre>
          {step.truncated ? (
            <div className={styles.summary}>{t('toolCallWebFetchTruncated')}</div>
          ) : null}
        </>
      )
    }
    if (step.type === 'edit') {
      return (
        <div className={styles.diff}>
          <div>
            <div className={styles.diffLabel}>{t('toolCallBefore')}</div>
            <pre className={styles.diffBlock}>{truncateLines(step.oldString ?? '', MAX_DIFF_LINES)}</pre>
          </div>
          <div>
            <div className={styles.diffLabel}>{t('toolCallAfter')}</div>
            <pre className={styles.diffBlock}>{truncateLines(step.newString ?? '', MAX_DIFF_LINES)}</pre>
          </div>
        </div>
      )
    }
    return null
  }

  const content = body()
  const expandable = content !== null && !wip

  return (
    <div className={styles.card} data-message={message.id}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expandable ? open : undefined}
        aria-label={expandable ? t(open ? 'toolCallCollapse' : 'toolCallExpand') : undefined}
        disabled={!expandable}
        onClick={() => expandable && setOpen((value) => !value)}
      >
        <span className={clsx(styles.icon, failed && styles.iconFailed)}>{icon}</span>
        <span className={clsx(styles.title, wip && styles.shimmer)}>{title}</span>
        {summary && !wip ? <span className={styles.summary}>{summary}</span> : null}
        {expandable ? (
          <span className={styles.chevron}>
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        ) : null}
      </button>
      {expandable && open ? <div className={styles.body}>{content}</div> : null}
      {undoAvailable || undone ? (
        <div className={styles.footer}>
          {undone ? (
            <span className={styles.undone}>{t('toolCallUndone')}</span>
          ) : (
            <Button variant="outlined" size="s" disabled={undoing} onClick={() => void undo()}>
              {t('toolCallUndo')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
