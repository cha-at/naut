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
 * 点击触发：桌面端向下展开锚定菜单，移动端从底部弹出操作表。
 * 点外部、遮罩或 Esc 关闭。
 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const close = () => setOpen(false)
  // 移动端使用底部操作表，不再需要锚定测量。
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open && !isMobile,
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
      {open && isMobile
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
      {open && !isMobile
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
