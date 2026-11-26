import { useTranslate } from '../../i18n/index.js'
import {
  setToolCapabilities,
  setToolEdit,
  setToolRead,
  setToolSearch,
  useSettings,
} from '../../services/settings.js'
import { isServerWebToolsDegraded } from '../../services/tools/schemas.js'
import { Button } from '../base/Button.js'
import { SwitchRow } from './SwitchRow.js'
import styles from './PersonalizationPage.module.css'

/**
 * 工具区：读取记忆（含文件列表）、编辑记忆、智能搜索三个单项开关。
 * 总开关在输入栏。接口不支持「内置联网工具 + 客户端工具」同请求时，
 * 联网搜索会自动改用独立的 Search / Fetch 接口，这里只做说明并提供重新检测。
 */
export const ToolSwitches = () => {
  const t = useTranslate()
  const toolsEnabled = useSettings((state) => state.toolsEnabled)
  const toolRead = useSettings((state) => state.toolRead)
  const toolEdit = useSettings((state) => state.toolEdit)
  const toolSearch = useSettings((state) => state.toolSearch)
  const degraded = useSettings((state) => isServerWebToolsDegraded(state.toolCapabilities))

  return (
    <section className={styles.section} aria-label={t('personalizationSectionTools')}>
      <div className={styles.sectionLabel}>{t('personalizationSectionTools')}</div>
      <div className={styles.card}>
        <SwitchRow
          label={t('toolReadLabel')}
          description={t('toolReadDescription')}
          checked={toolRead}
          onChange={() => setToolRead(!toolRead)}
        />
        <SwitchRow
          label={t('toolEditLabel')}
          description={t('toolEditDescription')}
          checked={toolEdit}
          onChange={() => setToolEdit(!toolEdit)}
        />
        <SwitchRow
          label={t('toolSearchLabel')}
          description={t('toolSearchDescription')}
          checked={toolSearch}
          onChange={() => setToolSearch(!toolSearch)}
        />
        <p className={styles.hint}>
          {toolsEnabled ? t('toolSectionMasterHint') : t('toolSectionMasterOff')}
        </p>
        {degraded ? (
          <div className={styles.compatNotice} role="status">
            <p className={styles.hint}>{t('toolCompatibilityNotice')}</p>
            <div className={styles.sectionActions}>
              <Button variant="outlined" size="s" onClick={() => setToolCapabilities({})}>
                {t('toolRetryCompatibility')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
