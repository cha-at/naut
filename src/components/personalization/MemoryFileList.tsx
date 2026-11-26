import { useCallback, useEffect, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { memoryErrorKey } from '../../services/memory/types.js'
import { memoryService } from '../../services/memory/index.js'
import {
  refreshMemoryUndo,
  undoMemoryEdit,
  useMemoryUndo,
} from '../../services/memory/memoryUndoState.js'
import {
  memoryFileNameError,
  withMarkdownExtension,
} from '../../services/memory/templates.js'
import type { MemoryEntry } from '../../services/memory/types.js'
import { useSettings } from '../../services/settings.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { IconPencil20, IconRefreshOutline16, IconTrashOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { formatFileSize, formatFileTime } from './format.js'
import { showMemoryEditor } from './personalizationState.js'
import styles from './PersonalizationPage.module.css'

type ListState = {
  status: 'loading' | 'ready' | 'error'
  entries: MemoryEntry[]
  truncated: boolean
  root: string | null
  error?: TranslationKey
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'rename'; name: string }
  | { kind: 'delete'; name: string }
  | null

/**
 * 记忆区：原生端是可管理的扁平目录（新建 / 重命名 / 删除 / 刷新 / 复制路径），
 * Web 端固定两份文档，只提供编辑入口。
 */
export const MemoryFileList = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const native = memoryService.isNative()
  const [state, setState] = useState<ListState>({
    status: 'loading',
    entries: [],
    truncated: false,
    root: null,
  })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [draft, setDraft] = useState('')
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const undoEntries = useMemoryUndo((value) => value.entries)

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading' }))
    try {
      await memoryService.ensureTemplates()
      const [paths, list] = await Promise.all([memoryService.paths(), memoryService.list()])
      setState({ status: 'ready', entries: list.entries, truncated: list.truncated, root: paths.root })
      await Promise.all(list.entries.map((entry) => refreshMemoryUndo(entry.name)))
    } catch (error) {
      setState({
        status: 'error',
        entries: [],
        truncated: false,
        root: null,
        error: memoryErrorKey(error),
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openCreate = () => {
    setDraft('')
    setFormError(null)
    setDialog({ kind: 'create' })
  }

  const openRename = (name: string) => {
    setDraft(name)
    setFormError(null)
    setDialog({ kind: 'rename', name })
  }

  const copyPath = async () => {
    if (!state.root) {
      return
    }
    showToast({ key: (await copyText(state.root)) ? 'copied' : 'copyFailed' })
  }

  const submitCreate = async () => {
    const name = withMarkdownExtension(draft)
    const invalid = memoryFileNameError(name)
    if (invalid) {
      setFormError(invalid)
      return
    }
    try {
      await memoryService.create(name)
      setDialog(null)
      await refresh()
      showMemoryEditor(name)
    } catch (error) {
      setFormError(memoryErrorKey(error))
    }
  }

  const submitRename = async () => {
    if (!dialog || dialog.kind !== 'rename') {
      return
    }
    const name = withMarkdownExtension(draft)
    if (name === dialog.name) {
      setDialog(null)
      return
    }
    const invalid = memoryFileNameError(name)
    if (invalid) {
      setFormError(invalid)
      return
    }
    try {
      await memoryService.rename(dialog.name, name)
      setDialog(null)
      await refresh()
    } catch (error) {
      setFormError(memoryErrorKey(error))
    }
  }

  const submitDelete = async () => {
    if (!dialog || dialog.kind !== 'delete') {
      return
    }
    try {
      await memoryService.remove(dialog.name)
      setDialog(null)
      await refresh()
    } catch (error) {
      setDialog(null)
      showToast({ key: memoryErrorKey(error), type: 'error' })
    }
  }

  const undoEdit = async (name: string) => {
    const result = await undoMemoryEdit(name)
    showToast(
      result.ok
        ? { key: 'memoryUndoSuccess' }
        : { key: result.error, type: 'error' }
    )
    if (result.ok) {
      await refresh()
    }
  }

  return (
    <section className={styles.section} aria-label={t('personalizationSectionMemory')}>
      <div className={styles.sectionLabel}>{t('personalizationSectionMemory')}</div>
      {state.status === 'loading' ? (
        <div className={styles.card}>
          <p className={styles.empty} role="status">
            {t('loading')}
          </p>
        </div>
      ) : state.status === 'error' ? (
        <div className={styles.card}>
          <p className={styles.empty} role="alert">
            {t(state.error ?? 'memoryLoadFailed')}
          </p>
          <div className={styles.sectionActions}>
            <Button variant="outlined" size="s" onClick={() => void refresh()}>
              {t('retry')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.rowTitle}>
              {t('memoryFileCount', { count: state.entries.length })}
            </span>
            <div className={styles.rowActions}>
              {native ? (
                <Button variant="outlined" size="s" onClick={openCreate}>
                  {t('memoryNewFile')}
                </Button>
              ) : null}
              <IconButton
                icon={<IconRefreshOutline16 />}
                tooltip={t('memoryRefresh')}
                tooltipPlacement="bottom"
                aria-label={t('memoryRefresh')}
                onClick={() => void refresh()}
              />
            </div>
          </div>
          {state.entries.map((entry) => {
            const undoEntry = undoEntries[entry.name]
            return (
              <div className={styles.row} key={entry.name}>
                <button
                  type="button"
                  className={styles.rowBody}
                  onClick={() => showMemoryEditor(entry.name)}
                >
                  <span className={styles.rowTitle}>
                    <span>{entry.name}</span>
                    {entry.isMemory ? (
                      <span className={styles.badge}>{t('memorySnapshotBadge')}</span>
                    ) : null}
                  </span>
                  <span className={styles.rowDescription}>
                    {formatFileSize(entry.size)} · {formatFileTime(entry.modifiedAt, locale)}
                  </span>
                </button>
                <div className={styles.rowActions}>
                  {undoEntry?.available ? (
                    <Button variant="outlined" size="s" onClick={() => void undoEdit(entry.name)}>
                      {t('memoryUndoLastEdit')}
                    </Button>
                  ) : null}
                  {native && !entry.isMemory ? (
                    <>
                      <IconButton
                        icon={<IconPencil20 />}
                        tooltip={t('memoryRename')}
                        tooltipPlacement="bottom"
                        aria-label={t('memoryRename')}
                        onClick={() => openRename(entry.name)}
                      />
                      <IconButton
                        icon={<IconTrashOutline16 />}
                        tooltip={t('delete')}
                        tooltipPlacement="bottom"
                        aria-label={t('delete')}
                        onClick={() => setDialog({ kind: 'delete', name: entry.name })}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
          {state.entries.length === 0 ? (
            <p className={styles.empty}>{t('memoryEmptyDir')}</p>
          ) : null}
          {state.truncated ? <p className={styles.hint}>{t('memoryFileTooMany')}</p> : null}
          {native && state.root ? (
            <div className={styles.pathRow}>
              <span className={styles.pathText} title={state.root}>
                {t('memoryPathLabel')}: {state.root}
              </span>
              <Button variant="outlined" size="s" onClick={() => void copyPath()}>
                {t('memoryCopyPath')}
              </Button>
            </div>
          ) : !native ? (
            <p className={styles.hint}>{t('memoryWebStorage')}</p>
          ) : null}
        </div>
      )}

      {dialog?.kind === 'create' || dialog?.kind === 'rename' ? (
        <Modal
          title={t(dialog.kind === 'create' ? 'memoryNewFileTitle' : 'memoryRenameTitle')}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setDialog(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                onClick={() => void (dialog.kind === 'create' ? submitCreate() : submitRename())}
              >
                {t('confirm')}
              </Button>
            </>
          }
        >
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="memory-file-name">
              {t('memoryFileName')}
            </label>
            <input
              id="memory-file-name"
              className={styles.input}
              autoFocus
              value={draft}
              placeholder="notes.md"
              onChange={(event) => {
                setDraft(event.target.value)
                setFormError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void (dialog.kind === 'create' ? submitCreate() : submitRename())
                }
              }}
            />
            {formError ? (
              <p className={styles.formError} role="alert">
                {t(formError)}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === 'delete' ? (
        <Modal
          title={t('memoryDeleteConfirmTitle')}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setDialog(null)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" size="m" onClick={() => void submitDelete()}>
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('memoryDeleteConfirmBody')}
        </Modal>
      ) : null}
    </section>
  )
}
