import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  clearPersonasCorrupt,
  deletePersona,
  resetDefaultPersona,
  setActivePersona,
  usePersonas,
} from '../../services/personas.js'
import { Button } from '../base/Button.js'
import { IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './PersonalizationPage.module.css'
import { showPersonaEditor } from './personalizationState.js'

/** 人格列表：默认人格置顶，点击整行设为当前；每行可编辑、删除 */
export const PersonaList = () => {
  const t = useTranslate()
  const personas = usePersonas((state) => state.personas)
  const activeId = usePersonas((state) => state.activeId)
  const corrupt = usePersonas((state) => state.corrupt)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const target = personas.find((persona) => persona.id === deletingId)

  const activate = (id: string) => {
    const result = setActivePersona(id)
    if (!result.ok) {
      showToast({ key: result.error, type: 'error' })
    }
  }

  const confirmDelete = () => {
    if (!deletingId) {
      return
    }
    const result = deletePersona(deletingId)
    setDeletingId(null)
    if (!result.ok) {
      showToast({ key: result.error, type: 'error' })
    }
  }

  const confirmReset = () => {
    const result = resetDefaultPersona()
    setResetting(false)
    if (!result.ok) {
      showToast({ key: result.error, type: 'error' })
    }
  }

  return (
    <section className={styles.section} aria-label={t('personalizationSectionPersona')}>
      <div className={styles.sectionLabel}>{t('personalizationSectionPersona')}</div>
      {corrupt ? (
        <p className={styles.notice} role="status">
          {t('personaCorruptNotice')}{' '}
          <button type="button" className={styles.rowActions} onClick={clearPersonasCorrupt}>
            {t('close')}
          </button>
        </p>
      ) : null}
      <div className={styles.card}>
        {personas.map((persona) => {
          const active = persona.id === activeId
          return (
            <div key={persona.id} className={styles.row}>
              <button
                type="button"
                className={styles.rowBody}
                aria-pressed={active}
                onClick={() => activate(persona.id)}
              >
                <span className={styles.rowTitle}>
                  <span>{persona.name}</span>
                  {active ? <span className={styles.badge}>{t('personaActive')}</span> : null}
                </span>
                <span className={styles.rowDescription}>
                  {persona.prompt.trim() || t('personaSummaryEmpty')}
                </span>
              </button>
              <div className={styles.rowActions}>
                <IconButton
                  icon={<IconEditOutline16 />}
                  tooltip={t('personaEdit')}
                  tooltipPlacement="bottom"
                  onClick={() => showPersonaEditor(persona.id)}
                />
                <IconButton
                  icon={<IconTrashOutline16 />}
                  tooltip={t('delete')}
                  tooltipPlacement="bottom"
                  disabled={personas.length <= 1}
                  onClick={() => setDeletingId(persona.id)}
                />
              </div>
            </div>
          )
        })}
        <button type="button" className={styles.addRow} onClick={() => showPersonaEditor()}>
          + {t('personaNew')}
        </button>
      </div>
      <div className={styles.sectionActions}>
        <Button variant="outlined" size="s" onClick={() => setResetting(true)}>
          {t('personaResetDefault')}
        </Button>
      </div>

      {target ? (
        <Modal
          title={t('personaDeleteConfirmTitle')}
          onClose={() => setDeletingId(null)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setDeletingId(null)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" size="m" onClick={confirmDelete}>
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('personaDeleteConfirmBody')}
        </Modal>
      ) : null}

      {resetting ? (
        <Modal
          title={t('personaResetConfirmTitle')}
          onClose={() => setResetting(false)}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={() => setResetting(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" size="m" onClick={confirmReset}>
                {t('personaResetDefault')}
              </Button>
            </>
          }
        >
          {t('personaResetConfirmBody')}
        </Modal>
      ) : null}
    </section>
  )
}
