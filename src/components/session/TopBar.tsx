import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { setTtsAuto, useSettings } from '../../services/settings.js'
import { newChat, useChatStore } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconMenu24,
  IconNewChatCircle24,
  IconSpeakerOff24,
  IconSpeakerOn24,
} from '../base/icons.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { useScrollState } from '../messages/scrollState.js'
import styles from './TopBar.module.css'

/**
 * 官方会话页顶栏：左菜单、居中标题、右侧自动朗读与新对话。
 *
 * 标题随列表滚动收缩变淡（对应官方 `sharedHeaderTitle` 的联动动画）；
 * 空会话没有标题，只保留两侧按钮。选中态整条替换顶栏还没做。
 */
export const TopBar = ({ title }: { title?: string }) => {
  const t = useTranslate()
  const atTop = useScrollState((state) => state.atTop)
  const ttsAuto = useSettings((state) => state.ttsAuto)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )

  return (
    <header className={styles.bar}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenu24 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : (
        <div className={clsx(styles.title, !atTop && styles.compact)} title={title}>
          <span className={styles.titleText}>{title}</span>
        </div>
      )}
      <div className={styles.actions}>
        <IconButton
          size="xl"
          tone="primary"
          icon={ttsAuto ? <IconSpeakerOn24 /> : <IconSpeakerOff24 />}
          aria-label={t('autoReadAloud')}
          aria-pressed={ttsAuto}
          onClick={() => setTtsAuto(!ttsAuto)}
        />
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatCircle24 />}
          aria-label={t('newChat')}
          disabled={streaming}
          onClick={newChat}
        />
      </div>
    </header>
  )
}
