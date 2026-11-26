import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconAlbum24, IconCamera24, IconFileUp24 } from '../base/icons.js'
import styles from './InputToolSheet.module.css'

export type InputToolKind = 'file' | 'camera' | 'album'

/** 输入框「+」打开的附件面板：官方那种从底部升起的入口列表 */
export const InputToolSheet = ({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (kind: InputToolKind) => void
}) => {
  const t = useTranslate()
  return createPortal(
    <div
      className={styles.mask}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={styles.sheet} role="dialog" aria-label={t('openInputTools')}>
        <div className={styles.handle} aria-hidden />
        <div className={styles.options}>
          <ToolItem
            icon={<IconFileUp24 />}
            label={t('inputToolsFile')}
            onClick={() => onPick('file')}
          />
          <ToolItem
            icon={<IconCamera24 />}
            label={t('inputToolsCamera')}
            onClick={() => onPick('camera')}
          />
          <ToolItem
            icon={<IconAlbum24 />}
            label={t('inputToolsAlbum')}
            onClick={() => onPick('album')}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}

const ToolItem = ({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) => (
  <button type="button" className={styles.item} onClick={onClick}>
    <span className={styles.itemIcon}>{icon}</span>
    <span className={styles.itemLabel}>{label}</span>
  </button>
)
