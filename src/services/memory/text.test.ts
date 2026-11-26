import { describe, expect, it } from 'vitest'
import {
  LINE_TRUNCATED_SUFFIX,
  normalizeText,
  splitLines,
  truncateToBytes,
  utf8ByteLength,
  windowContent,
} from './text.js'

const lines = (count: number, prefix = 'line') =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n')

describe('文本归一化', () => {
  it('去掉 BOM 并统一 LF', () => {
    expect(normalizeText('\uFEFFa\r\nb\r\n')).toBe('a\nb\n')
  })

  it('行数口径与 Rust lines 一致', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a')).toEqual(['a'])
    expect(splitLines('a\n')).toEqual(['a'])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
  })

  it('UTF-8 字节数按编码计算', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('中文')).toBe(6)
  })
})

describe('read 窗口', () => {
  it('默认返回全部 100 行并给出总行数', () => {
    const window = windowContent(lines(100))
    expect(window.totalLines).toBe(100)
    expect(window.startLine).toBe(1)
    expect(window.endLine).toBe(100)
    expect(window.truncated).toBe(false)
    expect(window.content.split('\n')[0]).toBe('line 1')
    expect(window.content.split('\n').at(-1)).toBe('line 100')
  })

  it('offset 与 limit 返回窗口并标记仍有剩余', () => {
    const window = windowContent(lines(100), 50, 10)
    expect(window.startLine).toBe(50)
    expect(window.endLine).toBe(59)
    expect(window.content.split('\n')).toHaveLength(10)
    expect(window.content.split('\n')[0]).toBe('line 50')
    expect(window.truncated).toBe(true)
  })

  it('offset 超过总行数返回空内容且不报错', () => {
    const window = windowContent(lines(5), 10, 10)
    expect(window.content).toBe('')
    expect(window.startLine).toBe(10)
    expect(window.endLine).toBe(9)
    expect(window.totalLines).toBe(5)
    expect(window.truncated).toBe(false)
  })

  it('超长单行截断并追加标记', () => {
    const window = windowContent('x'.repeat(2500))
    expect(window.lineTruncated).toBe(true)
    expect(window.content.endsWith(LINE_TRUNCATED_SUFFIX)).toBe(true)
    expect(window.content.length).toBe(2000 + LINE_TRUNCATED_SUFFIX.length)
  })

  it('超过 32 KiB 按行截断', () => {
    const window = windowContent(lines(100, 'y'.repeat(600)))
    expect(window.truncated).toBe(true)
    expect(utf8ByteLength(window.content)).toBeLessThanOrEqual(32 * 1024)
    expect(window.endLine).toBeLessThan(100)
  })

  it('limit 上限为 2000', () => {
    const window = windowContent(lines(2500), 1, 5000)
    expect(window.endLine).toBe(2000)
    expect(window.truncated).toBe(true)
  })
})

describe('快照截断', () => {
  it('未超限时不标记', () => {
    expect(truncateToBytes('hello', 16)).toEqual({ content: 'hello', truncated: false })
  })

  it('按行截断到 16 KiB 以内', () => {
    const content = lines(2000, 'z'.repeat(10))
    const result = truncateToBytes(content, 16 * 1024)
    expect(result.truncated).toBe(true)
    expect(utf8ByteLength(result.content)).toBeLessThanOrEqual(16 * 1024)
    expect(result.content.endsWith('\n')).toBe(false)
  })

  it('首行即超限时按码点截断，不切半个字符', () => {
    const result = truncateToBytes('中'.repeat(20000), 100)
    expect(result.truncated).toBe(true)
    expect(utf8ByteLength(result.content)).toBeLessThanOrEqual(100)
    expect(result.content).not.toContain('\uFFFD')
  })
})
