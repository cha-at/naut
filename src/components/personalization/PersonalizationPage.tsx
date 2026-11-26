import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronLeft20 } from '../base/icons.js'
import { BackupSection } from './BackupSection.js'
import { MemoryEditor } from './MemoryEditor.js'
import { MemoryFileList } from './MemoryFileList.js'
import { PersonaEditor } from './PersonaEditor.js'
import { PersonaList } from './PersonaList.js'
import {
  requestPersonalizationBack,
  usePersonalization,
} from './personalizationState.js'
import { ToolSwitches } from './ToolSwitches.js'
import styles from './PersonalizationPage.module.css'

/**
 * 个性化页：全屏覆盖设置，包含人格、工具、记忆、备份四个分区。
 * 人格编辑器与记忆编辑器是页面内的子页，返回时回到主页面。
 */
export const PersonalizationPage = () => {
  const open = usePersonalization((state) => state.open)
  return open ? <PersonalizationContent /> : null
}

const PersonalizationContent = () => {
  const t = useTranslate()
  const view = usePersonalization((state) => state.view)
  if (view.kind === 'persona') {
    return <PersonaEditor personaId={view.personaId} />
  }
  if (view.kind === 'memory') {
    return <MemoryEditor name={view.name} />
  }
  return <MainView title={t('personalizationTitle')} />
}

const MainView = ({ title }: { title: string }) => {
  const t = useTranslate()
  const titleRef = useRef<HTMLHeadingElement>(null)

  // 页面打开时焦点落在标题，返回后由关闭逻辑恢复到入口
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [])

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
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
      </header>
      <div className={styles.scroll}>
        <div className={styles.inner}>
          <PersonaList />
          <ToolSwitches />
          <MemoryFileList />
          <BackupSection />
        </div>
      </div>
    </div>
  )
}
