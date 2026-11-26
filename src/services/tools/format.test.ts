import { describe, expect, it } from 'vitest'
import type { MemoryListResult, MemoryReadResult } from '../memory/types.js'
import { formatEditResult, formatListResult, formatReadResult } from './format.js'

const readResult = (overrides: Partial<MemoryReadResult> = {}): MemoryReadResult => ({
  name: 'notes.md',
  size: 100,
  modifiedAt: 0,
  isMemory: false,
  content: 'first\nsecond',
  hash: 'abc',
  startLine: 1,
  endLine: 2,
  totalLines: 2,
  truncated: false,
  lineTruncated: false,
  ...overrides,
})

describe('read 结果格式', () => {
  it('带行号并给出分页信息', () => {
    const text = formatReadResult(readResult())
    expect(text).toBe('1: first\n2: second\n\n(Showing lines 1-2 of 2.)')
  })

  it('offset 决定行号起点', () => {
    const text = formatReadResult(
      readResult({ content: 'fifty\nfifty-one', startLine: 50, endLine: 51, totalLines: 100, truncated: true })
    )
    expect(text).toContain('50: fifty')
    expect(text).toContain('51: fifty-one')
    expect(text).toContain('(Showing lines 50-51 of 100. Use offset=52 to continue.)')
  })

  it('offset 超过总行数返回说明而非正文', () => {
    const text = formatReadResult(
      readResult({ content: '', startLine: 10, endLine: 9, totalLines: 5 })
    )
    expect(text).toBe(
      '(The file has 5 lines; offset 10 is past the end. Use offset=1 to read from the beginning.)'
    )
  })

  it('空文件给出空说明', () => {
    expect(formatReadResult(readResult({ content: '', startLine: 1, endLine: 0, totalLines: 0 }))).toBe(
      '(The file is empty.)'
    )
  })

  it('超长行截断与大文件提示', () => {
    const text = formatReadResult(
      readResult({
        content: 'x … (line truncated)',
        size: 70 * 1024,
        lineTruncated: true,
        endLine: 1,
        totalLines: 300,
        truncated: true,
      })
    )
    expect(text).toContain('(Some lines were truncated at 2000 characters.)')
    expect(text).toContain('(The file is larger than 64 KiB; edit will refuse to write it.)')
    expect(text).toContain('Use offset=2 to continue.')
  })
})

describe('list 结果格式', () => {
  const entry = (name: string, isMemory = false) => ({
    name,
    size: 1024,
    modifiedAt: Date.parse('2026-11-27T00:12:00Z'),
    isMemory,
  })

  it('记忆文件固定在前并标注，其余按名称排序', () => {
    const list: MemoryListResult = {
      entries: [entry('notes.md'), entry('MEMORY.md', true), entry('archive.md'), entry('USER.md', true)],
      truncated: false,
    }
    const rows = formatListResult(list).split('\n')
    expect(rows[0]).toBe('Memory directory: 4 files')
    expect(rows[1]).toContain('USER.md')
    expect(rows[1]).toContain('[memory, auto-injected]')
    expect(rows[2]).toContain('MEMORY.md')
    expect(rows[3]).toContain('archive.md')
    expect(rows[4]).toContain('notes.md')
    expect(rows[1]).toContain('2026-11-27')
  })

  it('空目录与截断提示', () => {
    expect(formatListResult({ entries: [], truncated: false })).toBe('The memory directory is empty.')
    const truncated = formatListResult({
      entries: [entry('USER.md', true)],
      truncated: true,
    })
    expect(truncated).toContain('(Only the first 200 files are shown.)')
  })
})

describe('edit 结果格式', () => {
  const outcome = (replacements: number) => ({
    replacements,
    entry: { name: 'MEMORY.md', size: 812, modifiedAt: 0, isMemory: true },
  })

  it('替换一处与多处', () => {
    expect(formatEditResult('MEMORY.md', outcome(1), 12)).toBe(
      'Edited MEMORY.md: replaced 1 occurrence (12 lines, 812 bytes).'
    )
    expect(formatEditResult('MEMORY.md', outcome(3), 12)).toContain('replaced 3 occurrences')
  })

  it('没有变化时说明 no changes', () => {
    expect(formatEditResult('USER.md', outcome(0), 2)).toBe(
      'No changes to USER.md (2 lines, 812 bytes).'
    )
  })
})
