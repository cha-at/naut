import clsx from 'clsx'
import styles from './PersonalizationPage.module.css'

/** 单个开关行：左侧标签与说明，右侧开关；整行可点击 */
export const SwitchRow = ({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={description ? `${label} — ${description}` : label}
    className={clsx(styles.row, styles.switchRow)}
    disabled={disabled}
    onClick={onChange}
  >
    <span className={styles.rowBody}>
      <span className={styles.rowTitle}>{label}</span>
      {description ? <span className={styles.rowDescription}>{description}</span> : null}
    </span>
    <span className={clsx(styles.switch, checked && styles.switchOn)} aria-hidden />
  </button>
)
