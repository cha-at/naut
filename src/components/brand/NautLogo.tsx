import clsx from 'clsx'
import { NAUT_MARK_PATH, NAUT_MARK_VIEWBOX } from './nautMark.js'
import styles from './NautLogo.module.css'

/**
 * 品牌位：官方客户端的鲸鱼换成 Naut 的波潮标记。
 *
 * `mark` 直接单色填充（欢迎态、设置页页脚）；`badge` 套一层圆形底，用于抽屉账户行。
 */
export const NautLogo = ({
  size = 48,
  variant = 'mark',
  className,
}: {
  size?: number
  variant?: 'mark' | 'badge'
  className?: string
}) => (
  <span
    className={clsx(styles.logo, variant === 'badge' && styles.badge, className)}
    style={{ width: size, height: size }}
  >
    <svg
      className={styles.svg}
      viewBox={NAUT_MARK_VIEWBOX}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d={NAUT_MARK_PATH} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  </span>
)
