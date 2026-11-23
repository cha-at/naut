import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { useImageViewer } from './imageViewerState.js'
import styles from './ImageViewer.module.css'

/** 图片原件的全屏预览，不依赖新标签页或系统图片查看器。 */
export const ImageViewer = () => {
  const t = useTranslate()
  const url = useImageViewer((state) => state.url)
  const name = useImageViewer((state) => state.name)
  const close = useImageViewer((state) => state.close)

  useEffect(() => {
    if (!url) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close, url])

  if (!url) {
    return null
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={close}
    >
      <img
        className={styles.image}
        src={url}
        alt={name}
        onClick={(event) => event.stopPropagation()}
      />
      <IconButton
        className={styles.close}
        size="xl"
        tone="primary"
        icon={<IconCloseOutline16 />}
        aria-label={t('close')}
        onClick={close}
      />
    </div>,
    document.body
  )
}
