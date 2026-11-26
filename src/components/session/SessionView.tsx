import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { GotoBottomButton } from '../messages/GotoBottomButton.js'
import { MessageList } from '../messages/MessageList.js'
import { TopBar } from './TopBar.js'
import styles from './SessionView.module.css'

/** 会话页：移动端为官方顶栏 + 消息列表 + 吸底输入区；桌面端保留标题栏与居中栏宽 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')

  if (isMobile) {
    return (
      <div className={styles.view}>
        <TopBar title={title} />
        <MessageList
          session={session}
          streaming={streaming}
          footer={
            <div className={styles.composer}>
              <GotoBottomButton />
              <ChatInput sessionId={session.id} />
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
          {title}
        </div>
      </div>
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
