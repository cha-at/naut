import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronDown20 } from '../base/icons.js'
import { useScrollToBottom } from './scrollContext.js'
import { useScrollState } from './scrollState.js'
import styles from './GotoBottomButton.module.css'

/** 「回到底部」悬浮按钮：滚离底部时出现在输入框上方，对齐官方 GotoBottomButton */
export const GotoBottomButton = () => {
  const t = useTranslate()
  const atBottom = useScrollState((state) => state.atBottom)
  const scrollToBottom = useScrollToBottom()
  return (
    <button
      type="button"
      className={clsx(styles.button, atBottom && styles.hidden)}
      aria-label={t('backToBottom')}
      aria-hidden={atBottom}
      tabIndex={atBottom ? -1 : 0}
      onClick={scrollToBottom}
    >
      <IconChevronDown20 />
    </button>
  )
}
