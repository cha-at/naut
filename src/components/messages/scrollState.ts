import { create } from 'zustand'

/**
 * 会话列表的滚动位置。
 * 顶栏标题的缩放 / 淡出、以及「回到底部」悬浮按钮都订阅这里，
 * 由 MessageList 在滚动时写入，避免把滚动状态层层往下传。
 */
type ScrollState = {
  atTop: boolean
  atBottom: boolean
  /** 当前会话 id，切换会话时用来丢弃上一段滚动状态 */
  sessionId: string | null
}

const IDLE: ScrollState = { atTop: true, atBottom: true, sessionId: null }

export const useScrollState = create<ScrollState>(() => IDLE)

export const setScrollPosition = (sessionId: string, atTop: boolean, atBottom: boolean) => {
  const state = useScrollState.getState()
  if (state.sessionId === sessionId && state.atTop === atTop && state.atBottom === atBottom) {
    return
  }
  useScrollState.setState({ sessionId, atTop, atBottom })
}

export const resetScrollState = () => useScrollState.setState(IDLE)
