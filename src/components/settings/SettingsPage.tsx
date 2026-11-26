import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { pickArchiveFile } from '../../platform/files.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  FONT_SCALES,
  setApiKey,
  setFontScale,
  setLocale,
  setThemePreference,
  setThinking,
  setTtsVoice,
  useSettings,
  type FontScale,
  type Locale,
  type ThemePreference,
} from '../../services/settings.js'
import { openPersonalization } from '../personalization/personalizationState.js'
import type { TtsVoice } from '../../services/api/speech.js'
import {
  IconChevronLeft20,
  IconChevronRight20,
  IconDownload20,
  IconFileText20,
  IconGlobe20,
  IconHelp20,
  IconInfo20,
  IconKey20,
  IconLogOut20,
  IconMic20,
  IconMoon20,
  IconSpeakerOn24,
  IconSparkles20,
  IconThinkOutline16,
  IconTrash20,
  IconType20,
  IconUpload20,
} from '../base/icons.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog } from './settingsDialogState.js'
import { OptionSheet, Sheet } from './SettingsSheet.js'
import {
  useHistoryDelete,
  useHistoryExport,
  useHistoryImport,
  type Status,
} from './useDataSettings.js'
import styles from './SettingsPage.module.css'

type SettingsSheetKey =
  | 'locale'
  | 'theme'
  | 'font'
  | 'tts'
  | 'personalization'
  | 'apiKey'
  | 'license'
  | 'disclaimer'
  | null

const appVersion = () =>
  document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? ''

const FONT_LABELS: Record<FontScale, TranslationKey> = {
  0.9: 'fontSizeSmall',
  1: 'fontSizeDefault',
  1.15: 'fontSizeLarge',
  1.3: 'fontSizeXLarge',
}

const THEME_LABELS: Record<ThemePreference, TranslationKey> = {
  light: 'avatarMenuSettingsDialogThemeSelectLightOption',
  dark: 'avatarMenuSettingsDialogThemeSelectDarkOption',
  system: 'avatarMenuSettingsDialogThemeSelectSystemOption',
}

const LOCALE_LABELS: Record<Locale, TranslationKey> = {
  'zh-CN': 'settingsLocaleZhCN',
  'en-US': 'settingsLocaleEnUS',
}

const TTS_LABELS: Record<TtsVoice, TranslationKey> = {
  stella: 'settingsTtsVoiceStella',
  tide: 'settingsTtsVoiceTide',
}

/** 移动端设置页：官方「应用 / 语音 / 数据 / 关于」四组卡片 + 底部免责声明 */
export const SettingsPage = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsPageContent /> : null
}

const SettingsPageContent = () => {
  const t = useTranslate()
  const [sheet, setSheet] = useState<SettingsSheetKey>(null)
  const [clearingKey, setClearingKey] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef<HTMLElement>(null)
  const section = useSettingsDialog((state) => state.section)
  const locale = useSettings((state) => state.locale)
  const themePreference = useSettings((state) => state.themePreference)
  const fontScale = useSettings((state) => state.fontScale)
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const thinking = useSettings((state) => state.thinking)
  const apiKey = useSettings((state) => state.apiKey)
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyExport = useHistoryExport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy =
    historyImport.busy || historyDelete.busy || replacingHistory || historyExport.busy

  const statusText = (status: Status): string | undefined =>
    status
      ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
      : undefined

  // 从「更换 API Key」等入口打开时直接落到对应分组
  useEffect(() => {
    if (section === 'data' && dataRef.current) {
      dataRef.current.scrollIntoView({ block: 'start' })
    } else {
      scrollRef.current?.scrollTo({ top: 0 })
    }
  }, [section])

  const importText = historyImport.progress
    ? `${historyImport.progress.processed}${
        historyImport.progress.total === undefined ? '' : ` / ${historyImport.progress.total}`
      }`
    : statusText(historyImport.status)

  const selectArchive = () => {
    void pickArchiveFile()
      .then((file) => {
        if (file) {
          historyImport.select(file)
        }
      })
      .catch(() => showToast({ key: 'historyImportFailed', type: 'error' }))
  }

  const maskKey = (value: string) =>
    value.length <= 8 ? '****' : `${value.slice(0, 3)}****${value.slice(-4)}`

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={t('back')}
          onClick={closeSettings}
        >
          <IconChevronLeft20 />
        </button>
        <h1 className={styles.title}>{t('settings')}</h1>
      </header>

      <div className={styles.scroll} ref={scrollRef}>
        <section className={styles.section}>
          <div className={styles.sectionLabel}>{t('settingsSectionApp')}</div>
          <div className={styles.card}>
            <Row
              icon={<IconGlobe20 />}
              label={t('settingsLocalePreference')}
              value={t(LOCALE_LABELS[locale])}
              onClick={() => setSheet('locale')}
            />
            <Row
              icon={<IconMoon20 />}
              label={t('settingsAppearance')}
              value={t(THEME_LABELS[themePreference])}
              onClick={() => setSheet('theme')}
            />
            <Row
              icon={<IconType20 />}
              label={t('settingsFontSize')}
              value={t(FONT_LABELS[fontScale])}
              onClick={() => setSheet('font')}
            />
            <Row
              id="settings-personalization-row"
              icon={<IconSparkles20 />}
              label={t('settingsPersonalization')}
              onClick={() => openPersonalization('general')}
            />
            <ToggleRow
              icon={<IconThinkOutline16 />}
              label={t('settingsThinkingDefault')}
              checked={thinking}
              onChange={() => setThinking(!thinking)}
            />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>{t('settingsSectionVoice')}</div>
          <div className={styles.card}>
            <Row
              icon={<IconMic20 />}
              label={t('settingsMainLanguage')}
              value={t('followApp')}
              chevron={false}
            />
            <Row
              icon={<IconSpeakerOn24 />}
              label={t('settingsTtsVoice')}
              value={t(TTS_LABELS[ttsVoice])}
              onClick={() => setSheet('tts')}
            />
          </div>
        </section>

        <section className={styles.section} ref={dataRef}>
          <div className={styles.sectionLabel}>{t('settingsSectionData')}</div>
          <div className={styles.card}>
            <Row
              icon={<IconKey20 />}
              label={t('settingsApiKey')}
              value={apiKey ? maskKey(apiKey) : t('apiKeyNotConfigured')}
              onClick={() => setSheet('apiKey')}
            />
            <Row
              icon={<IconUpload20 />}
              label={t('historyImport')}
              value={importText}
              chevron={false}
              disabled={historyBusy}
              onClick={selectArchive}
            />
            <Row
              icon={<IconDownload20 />}
              label={t('exportAllLabel')}
              value={statusText(historyExport.status)}
              chevron={false}
              disabled={historyBusy}
              onClick={() => void historyExport.run()}
            />
            <Row
              icon={<IconTrash20 />}
              label={t('deleteAllSessions')}
              danger
              chevron={false}
              disabled={historyBusy}
              onClick={historyDelete.open}
            />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>{t('settingsSectionAbout')}</div>
          <div className={styles.card}>
            <Row
              icon={<IconInfo20 />}
              label={t('settingsVersion')}
              value={appVersion()}
              chevron={false}
            />
            <Row
              icon={<IconFileText20 />}
              label={t('settingsLicense')}
              onClick={() => setSheet('license')}
            />
            <Row
              icon={<IconHelp20 />}
              label={t('settingsDisclaimer')}
              onClick={() => setSheet('disclaimer')}
            />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.card}>
            <Row
              icon={<IconLogOut20 />}
              label={t('clearApiKey')}
              danger
              chevron={false}
              onClick={() => setClearingKey(true)}
            />
          </div>
        </section>

        <footer className={styles.footer}>
          <div>
            {t('settingsModelName')}: Naut · {t('settingsVersion')} {appVersion()}
          </div>
          <div>{t('contentCaveat')}</div>
        </footer>
      </div>

      {sheet === 'locale' ? (
        <OptionSheet
          title={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN') },
            { value: 'en-US', label: t('settingsLocaleEnUS') },
          ]}
          onSelect={(value) => setLocale(value as Locale)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'theme' ? (
        <OptionSheet
          title={t('settingsAppearance')}
          value={themePreference}
          options={[
            { value: 'light', label: t('avatarMenuSettingsDialogThemeSelectLightOption') },
            { value: 'dark', label: t('avatarMenuSettingsDialogThemeSelectDarkOption') },
            { value: 'system', label: t('avatarMenuSettingsDialogThemeSelectSystemOption') },
          ]}
          onSelect={(value) => setThemePreference(value as ThemePreference)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'font' ? (
        <OptionSheet
          title={t('settingsFontSize')}
          value={String(fontScale)}
          options={FONT_SCALES.map((scale) => ({
            value: String(scale),
            label: t(FONT_LABELS[scale]),
          }))}
          onSelect={(value) => setFontScale(Number(value) as FontScale)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'tts' ? (
        <OptionSheet
          title={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onSelect={(value) => setTtsVoice(value as TtsVoice)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'apiKey' ? (
        <Sheet title={t('settingsApiKey')} onClose={() => setSheet(null)}>
          <div className={styles.apiKeyBody}>
            <ApiKeyField editor={apiKeyEditor} />
            <ApiKeyConfirm editor={apiKeyEditor} />
          </div>
        </Sheet>
      ) : null}

      {sheet === 'license' ? (
        <Sheet title={t('settingsLicense')} onClose={() => setSheet(null)}>
          <p className={styles.sheetText}>
            MIT License · Copyright (c) Naut contributors. Naut is a fork of deepseek-ai/chat-demo,
            also MIT licensed.
          </p>
        </Sheet>
      ) : null}

      {sheet === 'disclaimer' ? (
        <Sheet title={t('settingsDisclaimer')} onClose={() => setSheet(null)}>
          <p className={styles.sheetText}>{t('contentCaveat')}</p>
        </Sheet>
      ) : null}

      {historyImport.file ? (
        <Modal
          title={t('historyImportConfirmTitle')}
          onClose={historyImport.cancel}
          footer={
            <>
              <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => void historyImport.confirm()}
              >
                {t('historyImportConfirm')}
              </Button>
            </>
          }
        >
          {t('historyImportConfirmDescription')}
        </Modal>
      ) : null}

      {historyDelete.opened ? (
        <Modal
          title={t('deleteAllSessionsModalTitle')}
          onClose={historyDelete.cancel}
          footer={
            <>
              <Button
                variant="outlined"
                size="m"
                autoFocus
                disabled={historyDelete.busy}
                onClick={historyDelete.cancel}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                disabled={historyDelete.busy}
                onClick={() => void historyDelete.confirm()}
              >
                {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
              </Button>
            </>
          }
        >
          {t('deleteAllSessionsModalDescription')}
        </Modal>
      ) : null}

      {clearingKey ? (
        <Modal
          title={t('clearApiKeyConfirmTitle')}
          onClose={() => setClearingKey(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setClearingKey(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setApiKey(null)
                  showToast({ key: 'clearedApiKey' })
                  setClearingKey(false)
                }}
              >
                {t('clearApiKey')}
              </Button>
            </>
          }
        >
          {t('clearApiKeyConfirmDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 开关行：图标 + 标签 + 右侧开关，整行可点击 */
const ToggleRow = ({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: ReactNode
  label: string
  checked: boolean
  onChange: () => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={styles.row}
    onClick={onChange}
  >
    <span className={styles.rowIcon}>{icon}</span>
    <span className={styles.rowLabel}>{label}</span>
    <span className={clsx(styles.switch, checked && styles.switchOn)} aria-hidden />
  </button>
)

/** 设置行：图标 + 标签 + 右侧值 + 箭头，官方卡片里的一行 */
const Row = ({
  id,
  icon,
  label,
  value,
  onClick,
  danger = false,
  chevron = true,
  disabled = false,
}: {
  /** 供焦点恢复等场景定位行 */
  id?: string
  icon: ReactNode
  label: string
  value?: string
  onClick?: () => void
  danger?: boolean
  chevron?: boolean
  disabled?: boolean
}) => {
  const content = (
    <>
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.rowLabel}>{label}</span>
      {value ? <span className={styles.rowValue}>{value}</span> : null}
      {chevron ? (
        <span className={styles.chevron}>
          <IconChevronRight20 />
        </span>
      ) : null}
    </>
  )
  const className = clsx(styles.row, danger && styles.danger)
  if (!onClick) {
    return (
      <div id={id} className={className}>
        {content}
      </div>
    )
  }
  return (
    <button type="button" id={id} className={className} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  )
}

