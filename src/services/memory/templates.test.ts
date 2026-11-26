import { describe, expect, it } from 'vitest'
import {
  MEMORY_TEMPLATES,
  isReservedMemoryName,
  memoryFileNameError,
  memoryTemplate,
  withMarkdownExtension,
} from './templates.js'

describe('记忆模板', () => {
  it('两份模板与原生端保持一致', () => {
    expect(MEMORY_TEMPLATES['USER.md']).toBe('# USER.md\n\n> 用户偏好与资料；对话开始时会自动注入。\n\n')
    expect(MEMORY_TEMPLATES['MEMORY.md']).toBe('# MEMORY.md\n\n> 长期记忆；对话开始时会自动注入。\n\n')
    expect(memoryTemplate('USER.md')).toBe(MEMORY_TEMPLATES['USER.md'])
    expect(memoryTemplate('notes.md')).toBeNull()
  })

  it('保留名不区分大小写', () => {
    expect(isReservedMemoryName('USER.md')).toBe(true)
    expect(isReservedMemoryName('user.md')).toBe(true)
    expect(isReservedMemoryName('Memory.md')).toBe(true)
    expect(isReservedMemoryName('notes.md')).toBe(false)
  })
})

describe('额外文件名规则', () => {
  it('接受普通文件名', () => {
    expect(memoryFileNameError('notes.md')).toBeNull()
    expect(memoryFileNameError('项目记录.txt')).toBeNull()
    expect(memoryFileNameError('a'.repeat(64))).toBeNull()
  })

  it('拒绝空名、超长、路径分隔符、控制字符与点开头', () => {
    expect(memoryFileNameError('')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('   ')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('a'.repeat(65))).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('sub/notes.md')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('sub\\notes.md')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('bad\u0000name.md')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('.hidden.md')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('.')).toBe('memoryFileNameInvalid')
    expect(memoryFileNameError('..')).toBe('memoryFileNameInvalid')
  })

  it('拒绝保留名', () => {
    expect(memoryFileNameError('USER.md')).toBe('memoryReservedName')
    expect(memoryFileNameError('memory.md')).toBe('memoryReservedName')
  })

  it('新建时自动补 .md', () => {
    expect(withMarkdownExtension('notes')).toBe('notes.md')
    expect(withMarkdownExtension(' notes.txt ')).toBe('notes.txt')
    expect(withMarkdownExtension('a.b')).toBe('a.b')
  })
})
