import { useRef, useState } from 'react'
import type { TranslationKey, TranslationMessage } from '../../i18n/index.js'
import { saveBlobFile } from '../../platform/files.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { showToast } from '../base/toastState.js'

/**
 * 数据管理里三条异步流程的状态机：导入（覆盖）、导出、清空。
 * 桌面设置弹窗和移动端设置页共用，避免两套界面各写一遍。
 */

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
export type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
export const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
export const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<{ processed: number; total?: number } | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setProgress({ processed: 0 })
    setStatus(null)
    try {
      const count = await importHistory(file, (processed, total) =>
        setProgress({ processed, total })
      )
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setProgress(null)
    }
  }

  return {
    file,
    busy: progress !== null,
    progress,
    status,
    select: setFile,
    cancel: () => setFile(null),
    dismiss: () => {
      setFile(null)
      setStatus(null)
    },
    confirm,
  }
}

export const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
export const useHistoryExport = () => {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const run = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const result = await saveBlobFile(blob, name, 'archive')
      if (result.status === 'saved') {
        setStatus({ key: 'historyExportSaved' })
      } else if (result.status === 'failed') {
        setStatus(errorStatus('historyExportFailed', result.error ?? new Error('save failed')))
      }
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return { busy, status, run }
}
