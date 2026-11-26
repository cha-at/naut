import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  PERSONA_NAME_MAX,
  PERSONA_PROMPT_MAX,
  createPersona,
  updatePersona,
  usePersonas,
} from '../../services/personas.js'
import { Button } from '../base/Button.js'
import { IconChevronLeft20 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import {
  backToPersonalizationMain,
  requestPersonalizationBack,
  setPersonalizationBackGuard,
} from './personalizationState.js'
import styles from './PersonalizationPage.module.css'

/** 人格新建 / 编辑：名称必填、设定可空；有未保存修改时返回先确认 */
export const PersonaEditor = ({ personaId }: { personaId?: string }) => {
  const t = useTranslate()
  const persona = usePersonas((state) =>
    personaId ? state.personas.find((item) => item.id === personaId) : undefined
  )
  const editing = Boolean(personaId)
  const [name, setName] = useState(persona?.name ?? '')
  const [prompt, setPrompt] = useState(persona?.prompt ?? '')
  const [makeActive, setMakeActive] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const dirty = name !== (persona?.name ?? '') || prompt !== (persona?.prompt ?? '')
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // 编辑已删除的人格时回列表，避免空白表单
  useEffect(() => {
    if (personaId && !persona) {
      backToPersonalizationMain()
    }
  }, [personaId, persona])

  // Android 返回键与页面返回按钮共用同一拦截
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

  const save = useCallback(() => {
    const input = { name, prompt }
    const result =
      editing && personaId
        ? updatePersona(personaId, input)
        : createPersona({ ...input, makeActive })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    backToPersonalizationMain()
  }, [editing, makeActive, name, personaId, prompt])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={t('back')}
          onClick={requestPersonalizationBack}
        >
          <IconChevronLeft20 />
        </button>
        <h1 className={styles.title}>{t(editing ? 'personaEdit' : 'personaNew')}</h1>
      </header>
      <div className={styles.scroll}>
        <div className={styles.inner}>
          <div className={styles.card}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('personaNameLabel')}</span>
              <input
                className={styles.input}
                value={name}
                maxLength={PERSONA_NAME_MAX}
                aria-invalid={error === 'personaNameRequired' || error === 'personaNameTooLong'}
                placeholder={t('personaNameLabel')}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('personaPromptLabel')}</span>
              <textarea
                className={styles.textarea}
                value={prompt}
                maxLength={PERSONA_PROMPT_MAX}
                placeholder={t('personaPromptPlaceholder')}
                onChange={(event) => {
                  setPrompt(event.target.value)
                  setError(null)
                }}
              />
              <span className={styles.counter}>
                {prompt.length} / {PERSONA_PROMPT_MAX}
              </span>
            </label>
            {!editing ? (
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={makeActive}
                  onChange={(event) => setMakeActive(event.target.checked)}
                />
                {t('personaSetActive')}
              </label>
            ) : null}
          </div>
          {error ? (
            <p className={styles.formError} role="alert">
              {t(error)}
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.footer}>
        <Button variant="outlined" size="m" onClick={requestPersonalizationBack}>
          {t('cancel')}
        </Button>
        <Button variant="primary" size="m" className={styles.footerEnd} onClick={save}>
          {t('personaSave')}
        </Button>
      </div>

      {confirmDiscard ? (
        <Modal
          title={t('personaUnsavedTitle')}
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
    </div>
  )
}
