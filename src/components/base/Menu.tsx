import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../app/viewport.js'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/**
 * 点击触发：桌面端向下展开锚定菜单，移动端默认从底部弹出操作表（`popup` 则保留锚定菜单）。
 * 点外部、遮罩或 Esc 关闭。
 */
export const Menu = ({
  options,
  children,
  variant = 'auto',
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
  /** popup：移动端也用锚定浮层，对齐官方会话菜单 */
  variant?: 'auto' | 'popup'
}) => {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const popup = variant === 'popup' || !isMobile
  const close = () => setOpen(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open && popup,
    { align: 'start', alignOffset: -5, offset: 4 }
  )
  useDismiss(open, [anchorRef, floatingRef], close)

  const renderOptions = () => (
    <div className={styles.options}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="menuitem"
          className={clsx(styles.option, option.danger && styles.danger)}
          onClick={() => {
            setOpen(false)
            option.onSelect()
          }}
        >
          <span className={styles.icon}>{option.icon}</span>
          {option.label}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => setOpen((value) => !value) })}
      </span>
      {open && !popup
        ? createPortal(
            <div
              className={styles.sheetMask}
              onClick={(event) => event.target === event.currentTarget && close()}
            >
              <div ref={floatingRef} className={styles.sheet} role="menu">
                <div className={styles.handle} aria-hidden />
                {renderOptions()}
              </div>
            </div>,
            document.body
          )
        : null}
      {open && popup
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
            >
              {renderOptions()}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
