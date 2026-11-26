import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  isMemoryFileName,
  memoryErrorCode,
  memoryErrorKey,
  MEMORY_FILE_MAX_BYTES,
  type MemoryFile,
} from '../../services/memory/types.js'
import { memoryService } from '../../services/memory/index.js'
import { forgetMemoryUndo } from '../../services/memory/memoryUndoState.js'
import { utf8ByteLength } from '../../services/memory/text.js'
import { useSettings } from '../../services/settings.js'
import { saveBlobFile } from '../../platform/files.js'
import { Markdown } from '../markdown/Markdown.js'
import { Button } from '../base/Button.js'
import { IconChevronLeft20, IconDownloadOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { formatFileSize, formatFileTime } from './format.js'
import {
  backToPersonalizationMain,
  setPersonalizationBackGuard,
} from './personalizationState.js'
import styles from './PersonalizationPage.module.css'

type Status = 'loading' | 'ready' | 'error'

/**
 * 记忆编辑器：编辑 / 预览、保存、外部修改冲突、未保存确认。
 * 保存带加载时的哈希，冲突时让用户选择重新加载或覆盖保存。
 */
export const MemoryEditor = ({ name }: { name: string }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const native = memoryService.isNative()
  const [status, setStatus] = useState<Status>('loading')
  const [file, setFile] = useState<MemoryFile | null>(null)
  const [content, setContent] = useState('')
  const [baseline, setBaseline] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [path, setPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [deleted, setDeleted] = useState(false)

  const dirty = content !== baseline
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const tooLarge = utf8ByteLength(content) > MEMORY_FILE_MAX_BYTES

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const loaded = await memoryService.readFull(name)
      setFile(loaded)
      setContent(loaded.content)
      setBaseline(loaded.content)
      setStatus('ready')
      if (native) {
        const paths = await memoryService.paths()
        setPath(paths.files.find((item) => item.name === name)?.path ?? paths.root)
      }
    } catch (cause) {
      setStatus('error')
      setError(memoryErrorKey(cause))
    }
  }, [name, native])

  useEffect(() => {
    void load()
  }, [load])

  // 返回键与返回按钮共用：有未保存修改时先确认
  useEffect(() => {
    const guard = () => {
      if (dirtyRef.current) {
        setConfirmDiscard(true)
        return true
      }
      backToPersonalizationMain()
      return true
    }
    setPersonalizationBackGuard(guard)
    return () => setPersonalizationBackGuard(null)
  }, [])

  const write = useCallback(
    async (expectedHash?: string) => {
      setSaving(true)
      try {
        const saved = await memoryService.write(name, content, expectedHash)
        setFile(saved)
        setBaseline(content)
        // 用户保存后该文件的模型撤销备份失效
        forgetMemoryUndo(name)
        showToast({ key: 'fileSaved' })
        return true
      } catch (cause) {
        const code = memoryErrorCode(cause)
        if (code === 'conflict') {
          setConflict(true)
        } else if (code === 'not_found') {
          setDeleted(true)
        } else {
          showToast({ key: memoryErrorKey(cause), type: 'error' })
        }
        return false
      } finally {
        setSaving(false)
      }
    },
    [content, name]
  )

  const save = () => {
    if (tooLarge) {
      setError('memoryTooLarge')
      return
    }
    setError(null)
    void write(file?.hash ?? undefined)
  }

  const reload = async () => {
    setConflict(false)
    setDeleted(false)
    await load()
  }

  const overwrite = async () => {
    setConflict(false)
    if (await write(undefined)) {
      await load()
    }
  }

  const recreate = async () => {
    setDeleted(false)
    if (!isMemoryFileName(name)) {
      showToast({ key: 'memoryErrorNotFound', type: 'error' })
      return
    }
    if (await write(undefined)) {
      await load()
    }
  }

  const download = () => {
    void saveBlobFile(new Blob([content], { type: 'text/markdown;charset=utf-8' }), name).then(
      (result) => {
        if (result.status === 'saved') {
          showToast({ key: 'fileSaved' })
        } else if (result.status === 'failed') {
          showToast({ key: 'backupExportFailed', type: 'error' })
        }
      }
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={t('back')}
          onClick={() => {
            if (dirty) {
              setConfirmDiscard(true)
            } else {
              backToPersonalizationMain()
            }
          }}
        >
          <IconChevronLeft20 />
        </button>
        <h1 className={styles.title}>{name}</h1>
        <div className={styles.headerAction}>
          {!native ? (
            <IconButton
              icon={<IconDownloadOutline16 />}
              tooltip={t('backupDownloadMemory')}
              tooltipPlacement="bottom"
              aria-label={t('backupDownloadMemory')}
              onClick={download}
            />
          ) : null}
          <Button
            variant="primary"
            size="s"
            disabled={!dirty || saving || tooLarge}
            onClick={save}
          >
            {t('memoryEditorSave')}
          </Button>
        </div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.inner}>
          {status === 'loading' ? (
            <div className={styles.card}>
              <p className={styles.empty} role="status">
                {t('loading')}
              </p>
            </div>
          ) : status === 'error' ? (
            <div className={styles.card}>
              <p className={styles.empty} role="alert">
                {t(error ?? 'memoryLoadFailed')}
              </p>
              <div className={styles.sectionActions}>
                <Button variant="outlined" size="s" onClick={() => void load()}>
                  {t('retry')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.card}>
              <div className={styles.row}>
                <div className={styles.rowActions}>
                  <Button
                    variant={mode === 'edit' ? 'primary' : 'outlined'}
                    size="s"
                    aria-pressed={mode === 'edit'}
                    onClick={() => setMode('edit')}
                  >
                    {t('memoryEdit')}
                  </Button>
                  <Button
                    variant={mode === 'preview' ? 'primary' : 'outlined'}
                    size="s"
                    aria-pressed={mode === 'preview'}
                    onClick={() => setMode('preview')}
                  >
                    {t('memoryPreview')}
                  </Button>
                </div>
              </div>
              <div className={styles.meta}>
                <span>
                  {formatFileSize(utf8ByteLength(content))}
                  {tooLarge ? ` · ${t('memoryTooLarge')}` : null}
                </span>
                {file ? <span>{formatFileTime(file.modifiedAt, locale)}</span> : null}
                <span>{native ? path ?? name : t('memoryWebStorage')}</span>
              </div>
              {mode === 'edit' ? (
                <>
                  <textarea
                    className={styles.textarea}
                    aria-label={name}
                    value={content}
                    spellCheck={false}
                    onChange={(event) => {
                      setContent(event.target.value)
                      setError(null)
                    }}
                  />
                  {error ? (
                    <p className={styles.formError} role="alert">
                      {t(error)}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className={styles.preview}>
                  <Markdown
                    content={content}
                    loading={false}
                    cacheKey={`${name}-preview`}
                    disableLink={false}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmDiscard ? (
        <Modal
          title={t('memoryEditorUnsavedTitle')}
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setConfirmDiscard(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" size="m" onClick={backToPersonalizationMain}>
                {t('discard')}
              </Button>
            </>
          }
        >
          {t('memoryEditorUnsavedBody')}
        </Modal>
      ) : null}

      {conflict ? (
        <Modal
          title={t('memoryEditorConflictTitle')}
          onClose={() => setConflict(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => void reload()}>
                {t('memoryEditorConflictReload')}
              </Button>
              <Button variant="danger" size="m" onClick={() => void overwrite()}>
                {t('memoryEditorConflictOverwrite')}
              </Button>
            </>
          }
        >
          {t('memoryEditorConflictBody')}
        </Modal>
      ) : null}

      {deleted ? (
        <Modal
          title={t('memoryEditorDeletedTitle')}
          onClose={() => setDeleted(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setDeleted(false)}>
                {t('cancel')}
              </Button>
              {isMemoryFileName(name) ? (
                <Button variant="primary" size="m" onClick={() => void recreate()}>
                  {t('memoryEditorRecreate')}
                </Button>
              ) : null}
            </>
          }
        >
          {t('memoryEditorDeletedBody')}
        </Modal>
      ) : null}
    </div>
  )
}
