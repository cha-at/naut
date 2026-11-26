import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  removeSession,
  renameSession,
  selectSession,
  togglePinSession,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconCheck20,
  IconDatabase20,
  IconEllipsisV20,
  IconListChecks20,
  IconPencil20,
  IconPin20,
  IconPinOff20,
  IconSearch20,
  IconSettingsOutline16,
  IconSliders20,
  IconTrash20,
} from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { NautLogo } from '../brand/NautLogo.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import styles from './Drawer.module.css'

const LONG_PRESS = 450

/** 官方会话抽屉：搜索、月份分组、多选、置顶、行内菜单、账户行 */
export const Drawer = () => {
  const open = useMobileSider((state) => state.open)
  return open ? <DrawerContent /> : null
}

const DrawerContent = () => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const apiKey = useSettings((state) => state.apiKey)
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swallowClick = useRef(false)

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return sessions
    }
    return sessions.filter((session) =>
      (session.title || t('untitledChat')).toLowerCase().includes(keyword)
    )
  }, [sessions, query, t])

  const pinned = visible.filter((session) => session.pinned)
  const rest = visible.filter((session) => !session.pinned)
  const groups = useMemo(() => groupSessions(rest, Date.now(), t, 'month'), [rest, t])

  useEffect(
    () => () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
      }
    },
    []
  )

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const exitSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const startLongPress = (toggle: () => void) => {
    clearTimeout(longPressTimer.current ?? undefined)
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      swallowClick.current = true
      toggle()
    }, LONG_PRESS)
  }

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const openRow = (id: string) => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (selecting) {
      toggleSelected(id)
      return
    }
    selectSession(id)
    closeMobileSider()
  }

  const confirmDelete = async (target: SessionSummary) => {
    setDeletePending(true)
    try {
      if (await removeSession(target.id)) {
        setDeleting(null)
      } else {
        showToast({ key: 'sessionDeleteFailed', type: 'error' })
      }
    } finally {
      setDeletePending(false)
    }
  }

  const deleteSelected = async () => {
    const targets = [...selected]
    let failed = false
    for (const id of targets) {
      if (!(await removeSession(id))) {
        failed = true
      }
    }
    if (failed) {
      showToast({ key: 'sessionDeleteFailed', type: 'error' })
    }
    exitSelecting()
  }

  const finishRename = (session: SessionSummary, value: string) => {
    setRenaming(null)
    const title = value.trim()
    if (title && title !== (session.title || t('untitledChat'))) {
      renameSession(session.id, title)
    }
  }

  const rowMenu = (session: SessionSummary) => [
    {
      key: 'rename',
      label: t('sessionItemMenuRenameOption'),
      icon: <IconPencil20 />,
      onSelect: () => setRenaming(session.id),
    },
    {
      key: 'pin',
      label: session.pinned ? t('unpinSession') : t('pinSession'),
      icon: session.pinned ? <IconPinOff20 /> : <IconPin20 />,
      onSelect: () => togglePinSession(session.id),
    },
    {
      key: 'select',
      label: t('selectSessions'),
      icon: <IconListChecks20 />,
      onSelect: () => {
        setSelecting(true)
        setSelected(new Set([session.id]))
      },
    },
    {
      key: 'delete',
      label: t('delete'),
      icon: <IconTrash20 />,
      danger: true,
      onSelect: () => setDeleting(session),
    },
  ]

  const renderRow = (session: SessionSummary) => {
    const label = session.title || t('untitledChat')
    const checked = selected.has(session.id)
    return (
      <div
        key={session.id}
        className={clsx(styles.row, session.id === activeId && styles.active)}
        role="button"
        tabIndex={0}
        onClick={() => openRow(session.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openRow(session.id)
          }
        }}
      >
        {selecting ? (
          <span className={clsx(styles.checkbox, checked && styles.checkboxOn)}>
            {checked ? <IconCheck20 /> : null}
          </span>
        ) : null}
        {renaming === session.id ? (
          <input
            className={styles.rename}
            defaultValue={label}
            autoFocus
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => finishRename(session, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                finishRename(session, event.currentTarget.value)
              } else if (event.key === 'Escape') {
                setRenaming(null)
              }
            }}
          />
        ) : (
          <span className={styles.rowTitle}>{label}</span>
        )}
        {selecting ? null : (
          <Menu variant="popup" options={rowMenu(session)}>
            {({ toggle }) => (
              <button
                type="button"
                className={styles.more}
                aria-label={t('more')}
                onClick={(event) => {
                  event.stopPropagation()
                  toggle()
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  startLongPress(toggle)
                }}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
              >
                <IconEllipsisV20 />
              </button>
            )}
          </Menu>
        )}
      </div>
    )
  }

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`
    : t('apiKeyNotConfigured')

  return (
    <>
      <div className={styles.mask} onClick={closeMobileSider} />
      <aside className={styles.drawer} aria-label={t('appName')}>
        <div className={styles.search}>
          <IconSearch20 />
          <input
            className={styles.searchInput}
            type="search"
            value={query}
            placeholder={t('searchSessionsPlaceholder')}
            aria-label={t('searchSessionsPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className={styles.list}>
          {visible.length === 0 ? <div className={styles.empty}>{t('noSessionsFound')}</div> : null}
          {pinned.length > 0 ? (
            <div className={styles.group}>
              <div className={styles.groupLabel}>
                <span>{t('pinnedGroupLabel')}</span>
              </div>
              {pinned.map(renderRow)}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className={styles.group}>
              <div className={styles.groupLabel}>
                <span>{group.label}</span>
                {group === groups[0] && !selecting ? (
                  <IconButton
                    size="xs"
                    tone="tertiary"
                    icon={<IconSliders20 />}
                    aria-label={t('selectSessions')}
                    onClick={() => setSelecting(true)}
                  />
                ) : null}
                {group === groups[0] && selecting ? (
                  <button type="button" className={styles.textButton} onClick={exitSelecting}>
                    {t('cancel')}
                  </button>
                ) : null}
              </div>
              {group.sessions.map(renderRow)}
            </div>
          ))}
        </div>

        {selecting ? (
          <div className={styles.multiBar}>
            <span className={styles.multiCount}>
              {t('selectedCount', { count: selected.size })}
            </span>
            <button
              type="button"
              className={styles.deleteSelected}
              disabled={selected.size === 0}
              onClick={deleteSelected}
            >
              {t('deleteSelectedSessions')}
            </button>
          </div>
        ) : null}

        <div className={styles.footer}>
          <NautLogo size={34} variant="badge" />
          <span className={styles.account} title={maskedKey}>
            {maskedKey}
          </span>
          <Menu
            variant="popup"
            options={[
              {
                key: 'settings',
                label: t('settings'),
                icon: <IconSettingsOutline16 />,
                onSelect: () => {
                  closeMobileSider()
                  openSettings('general')
                },
              },
              {
                key: 'data',
                label: t('settingDialogAsideDataOptionLabel'),
                icon: <IconDatabase20 />,
                onSelect: () => {
                  closeMobileSider()
                  openSettings('data')
                },
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton
                size="m"
                tone="tertiary"
                icon={<IconEllipsisV20 />}
                aria-label={t('more')}
                onClick={toggle}
              />
            )}
          </Menu>
        </div>
      </aside>

      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={() => void confirmDelete(deleting)}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </>
  )
}
