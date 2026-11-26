import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { NautLogo } from '../brand/NautLogo.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { TopBar } from './TopBar.js'
import styles from './Welcome.module.css'

/** 新对话：品牌标记 + 问候语，输入框吸底；桌面端保持居中布局 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <div className={styles.view}>
        <TopBar />
        <div className={styles.hero}>
          <NautLogo size={48} />
          <div className={styles.greeting}>{t('welcomeMessageMobile')}</div>
        </div>
        <div className={styles.composer}>
          <ChatInput sessionId={null} />
        </div>
      </div>
    )
  }
  return (
    <div className={styles.container}>
      <div className={styles.welcome}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
      </div>
    </div>
  )
}
