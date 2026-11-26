import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * 组件测试环境补齐：jsdom 没有媒体查询、尺寸观察与滚动相关 API。
 * 这里只提供最小实现，行为相关断言由各用例覆盖。
 */

const noop = () => {}

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }),
  })
}

if (typeof window.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
  })
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = noop
}

if (typeof window.scrollTo !== 'function') {
  Object.defineProperty(window, 'scrollTo', { writable: true, value: noop })
}

afterEach(() => {
  cleanup()
})
