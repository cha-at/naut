import { translate } from '../../i18n/index.js'
import { monthKey } from '../../utils/format.js'
import type { SessionSummary } from './types.js'

const DAY = 86_400_000

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/** 月份分组标题按当前界面语言格式化：中文「2026年11月」，英文「November 2026」 */
const monthLabel = (time: number): string => {
  const locale =
    typeof document === 'undefined' ? 'zh-CN' : document.documentElement.lang || 'zh-CN'
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(
      new Date(time)
    )
  } catch {
    return monthKey(time) ?? ''
  }
}

/** 分组：默认按 今天 / 昨天 / 7 天内 / 30 天内 / 按月；month 模式只按月，用于官方抽屉 */
export const groupSessions = (
  sessions: SessionSummary[],
  now: number,
  t = translate,
  mode: 'timeline' | 'month' = 'timeline'
) => {
  const groups: { key: string; label: string; sessions: SessionSummary[] }[] = []
  for (const session of sessions) {
    if (mode === 'month') {
      const label = monthLabel(session.updatedAt)
      const last = groups.at(-1)
      if (last?.key === label) {
        last.sessions.push(session)
      } else {
        groups.push({ key: label, label, sessions: [session] })
      }
      continue
    }
    const diff = Math.floor((now - startOfDay(session.updatedAt)) / DAY)
    const key =
      diff <= 0
        ? 'sessionHistoryTimelineLabelToday'
        : diff <= 1
          ? 'sessionHistoryTimelineLabelYesterday'
          : diff < 7
            ? 'sessionHistoryTimelineLabel7days'
            : diff < 30
              ? 'sessionHistoryTimelineLabel30days'
              : null
    const groupKey = key ?? monthKey(session.updatedAt) ?? ''
    const last = groups.at(-1)
    if (last?.key === groupKey) {
      last.sessions.push(session)
    } else {
      groups.push({ key: groupKey, label: key ? t(key) : groupKey, sessions: [session] })
    }
  }
  return groups
}
