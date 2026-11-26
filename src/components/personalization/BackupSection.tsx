import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { memoryService } from '../../services/memory/index.js'
import { MEMORY_FILE_MAX_BYTES } from '../../services/memory/types.js'
import { utf8ByteLength } from '../../services/memory/text.js'
import {
  exportPersonas,
  parsePersonasImport,
  replacePersonas,
  type PersonasData,
} from '../../services/personas.js'
import { forgetMemoryUndo } from '../../services/memory/memoryUndoState.js'
import { pickTextFile, saveBlobFile } from '../../platform/files.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './PersonalizationPage.module.css'

type PendingImport =
  | { kind: 'personas'; data: PersonasData }
  | { kind: 'memory'; name: string; text: string }
  | null

const MEMORY_NAMES = ['USER.md', 'MEMORY.md'] as const

/** 备份区：人格 JSON 导出 / 导入；Web 端逐文件下载与导入记忆文件 */
export const BackupSection = () => {
  const t = useTranslate()
  const native = memoryService.isNative()
  const [pending, setPending] = useState<PendingImport>(null)

  const exportPersonaFile = async () => {
    const blob = new Blob([exportPersonas()], { type: 'application/json;charset=utf-8' })
    const result = await saveBlobFile(blob, 'naut-personas.json')
    if (result.status === 'saved') {
      showToast({ key: 'backupPersonaExported' })
    } else if (result.status === 'failed') {
      showToast({ key: 'backupExportFailed', type: 'error' })
    }
  }

  const pickPersonaFile = async () => {
    let picked: { name: string; text: string } | null = null
    try {
      picked = await pickTextFile({ accept: '.json,application/json', extensions: ['json'] })
    } catch {
      showToast({ key: 'personaInvalidFile', type: 'error' })
      return
    }
    if (!picked) {
      return
    }
    const data = parsePersonasImport(picked.text)
    if (!data) {
      showToast({ key: 'personaInvalidFile', type: 'error' })
      return
    }
    setPending({ kind: 'personas', data })
  }

  const downloadMemory = async (name: string) => {
    try {
      const file = await memoryService.readFull(name)
      const result = await saveBlobFile(
        new Blob([file.content], { type: 'text/markdown;charset=utf-8' }),
        name
      )
      if (result.status === 'saved') {
        showToast({ key: 'fileSaved' })
      } else if (result.status === 'failed') {
        showToast({ key: 'backupExportFailed', type: 'error' })
      }
    } catch {
      showToast({ key: 'backupExportFailed', type: 'error' })
    }
  }

  const pickMemoryFile = async (name: string) => {
    let picked: { name: string; text: string } | null = null
    try {
      picked = await pickTextFile({
        accept: '.md,.markdown,.txt,text/markdown,text/plain',
        extensions: ['md', 'markdown', 'txt'],
      })
    } catch {
      showToast({ key: 'backupInvalidMemory', type: 'error' })
      return
    }
    if (!picked) {
      return
    }
    if (
      utf8ByteLength(picked.text) > MEMORY_FILE_MAX_BYTES ||
      picked.text.includes('\uFFFD')
    ) {
      showToast({ key: 'backupInvalidMemory', type: 'error' })
      return
    }
    setPending({ kind: 'memory', name, text: picked.text })
  }

  const confirmImport = async () => {
    if (!pending) {
      return
    }
    if (pending.kind === 'personas') {
      replacePersonas(pending.data)
      showToast({ key: 'backupPersonaImported' })
      setPending(null)
      return
    }
    try {
      await memoryService.write(pending.name, pending.text)
      forgetMemoryUndo(pending.name)
      showToast({ key: 'backupMemoryImported' })
    } catch {
      showToast({ key: 'backupInvalidMemory', type: 'error' })
    }
    setPending(null)
  }

  return (
    <section className={styles.section} aria-label={t('personalizationSectionBackup')}>
      <div className={styles.sectionLabel}>{t('personalizationSectionBackup')}</div>
      <div className={styles.card}>
        <div className={styles.backupGrid}>
          <Button variant="outlined" size="m" onClick={() => void exportPersonaFile()}>
            {t('backupExportPersonas')}
          </Button>
          <Button variant="outlined" size="m" onClick={() => void pickPersonaFile()}>
            {t('backupImportPersonas')}
          </Button>
        </div>
        {native ? (
          <p className={styles.hint}>{t('memoryNativeBackupHint')}</p>
        ) : (
          <div className={styles.backupGrid}>
            {MEMORY_NAMES.map((name) => (
              <div className={styles.rowActions} key={name}>
                <Button variant="outlined" size="s" onClick={() => void downloadMemory(name)}>
                  {t('backupDownloadMemory')} · {name}
                </Button>
                <Button variant="outlined" size="s" onClick={() => void pickMemoryFile(name)}>
                  {t('backupImportMemory')} · {name}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending?.kind === 'personas' ? (
        <Modal
          title={t('backupPersonaImportConfirmTitle')}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setPending(null)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" size="m" onClick={() => void confirmImport()}>
                {t('confirm')}
              </Button>
            </>
          }
        >
          {t('backupPersonaImportConfirmBody')}
        </Modal>
      ) : null}

      {pending?.kind === 'memory' ? (
        <Modal
          title={t('backupMemoryImportConfirmTitle')}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setPending(null)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" size="m" onClick={() => void confirmImport()}>
                {t('memoryEditorConflictOverwrite')}
              </Button>
            </>
          }
        >
          {t('backupMemoryImportConfirmBody')}
        </Modal>
      ) : null}
    </section>
  )
}
