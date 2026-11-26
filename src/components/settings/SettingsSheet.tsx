import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { IconCheck20 } from '../base/icons.js'
import styles from './SettingsPage.module.css'

/** 设置页里的小选择面板：官方那种从底部升起的圆角卡片 */
export const Sheet = ({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) =>
  createPortal(
    <div
      className={styles.sheetMask}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={styles.sheet} role="dialog" aria-label={title}>
        <div className={styles.sheetHandle} aria-hidden />
        <div className={styles.sheetTitle}>{title}</div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>,
    document.body
  )

export type SheetOption = { value: string; label: string }

/** 单选面板：语言、外观、字号、音色共用 */
export const OptionSheet = ({
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  title: string
  options: SheetOption[]
  value: string
  onSelect: (value: string) => void
  onClose: () => void
}) => (
  <Sheet title={title} onClose={onClose}>
    <div role="radiogroup" aria-label={title}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={styles.sheetOption}
          onClick={() => {
            onSelect(option.value)
            onClose()
          }}
        >
          <span>{option.label}</span>
          {option.value === value ? <IconCheck20 /> : null}
        </button>
      ))}
    </div>
  </Sheet>
)
