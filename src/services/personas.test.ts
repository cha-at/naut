import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../i18n/index.js'

const PERSONAS_KEY = 'chat-demo:personas'

/** 每次重新加载模块，模拟应用启动时从 localStorage 初始化 */
const load = async () => {
  vi.resetModules()
  return import('./personas.js')
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-27T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('personas 初始化', () => {
  it('全新安装只有默认人格，并把它设为当前', async () => {
    const { usePersonas, DEFAULT_PERSONA_ID } = await load()
    const state = usePersonas.getState()
    expect(state.personas).toHaveLength(1)
    expect(state.personas[0].id).toBe(DEFAULT_PERSONA_ID)
    expect(state.activeId).toBe(DEFAULT_PERSONA_ID)
    expect(state.personas[0].prompt).toBe('')
    expect(state.corrupt).toBe(false)
  })

  it('损坏数据回退默认人格并记录提示', async () => {
    localStorage.setItem(PERSONAS_KEY, '{"version":1,"personas":')
    const { usePersonas } = await load()
    const state = usePersonas.getState()
    expect(state.personas).toHaveLength(1)
    expect(state.corrupt).toBe(true)
    expect(localStorage.getItem('chat-demo:personas:corrupt')).toBeTruthy()
  })

  it('activeId 不在列表中时回退默认人格', async () => {
    localStorage.setItem(
      PERSONAS_KEY,
      JSON.stringify({
        version: 1,
        activeId: 'missing',
        personas: [{ id: 'a', name: '严谨工程师', prompt: '', createdAt: 1, updatedAt: 1 }],
      })
    )
    const { usePersonas } = await load()
    expect(usePersonas.getState().corrupt).toBe(true)
    expect(usePersonas.getState().activeId).toBe('default-persona')
  })

  it('版本不识别时回退默认人格', async () => {
    localStorage.setItem(PERSONAS_KEY, JSON.stringify({ version: 2, activeId: 'a', personas: [] }))
    const { usePersonas } = await load()
    expect(usePersonas.getState().corrupt).toBe(true)
  })
})

describe('personas CRUD', () => {
  it('新建人格不自动切换当前人格，默认人格置顶', async () => {
    const m = await load()
    const result = m.createPersona({ name: '  严谨工程师  ', prompt: '你是一位严谨的工程师。' })
    expect(result.ok).toBe(true)
    const state = m.usePersonas.getState()
    expect(state.personas).toHaveLength(2)
    expect(state.personas[0].id).toBe(m.DEFAULT_PERSONA_ID)
    expect(state.personas[1].name).toBe('严谨工程师')
    expect(state.activeId).toBe(m.DEFAULT_PERSONA_ID)
    // 持久化
    const stored = JSON.parse(localStorage.getItem(PERSONAS_KEY) ?? '{}')
    expect(stored.personas).toHaveLength(2)
    expect(stored.activeId).toBe(m.DEFAULT_PERSONA_ID)
  })

  it('勾选「设为当前」时切换', async () => {
    const m = await load()
    const created = m.createPersona({ name: '轻松朋友', prompt: '', makeActive: true })
    expect(created.ok).toBe(true)
    expect(m.usePersonas.getState().activeId).toBe(created.ok ? created.value?.id : '')
  })

  it('名称必填、长度受限、去重不区分大小写', async () => {
    const m = await load()
    expect(m.createPersona({ name: '   ', prompt: '' })).toEqual({
      ok: false,
      error: 'personaNameRequired',
    })
    expect(m.createPersona({ name: 'a'.repeat(41), prompt: '' })).toEqual({
      ok: false,
      error: 'personaNameTooLong',
    })
    expect(m.createPersona({ name: 'x', prompt: 'y'.repeat(8001) })).toEqual({
      ok: false,
      error: 'personaPromptTooLong',
    })
    expect(m.createPersona({ name: 'Engineer', prompt: '' }).ok).toBe(true)
    expect(m.createPersona({ name: ' engineer ', prompt: '' })).toEqual({
      ok: false,
      error: 'personaDuplicateName',
    })
    expect(m.usePersonas.getState().personas).toHaveLength(2)
  })

  it('编辑更新 updatedAt，重名（其他项）被拒绝', async () => {
    const m = await load()
    const first = m.createPersona({ name: 'A', prompt: 'a' })
    const second = m.createPersona({ name: 'B', prompt: 'b' })
    if (!first.ok || !second.ok || !first.value || !second.value) {
      throw new Error('setup failed')
    }
    vi.setSystemTime(new Date('2026-11-27T01:00:00Z'))
    const updated = m.updatePersona(first.value.id, { name: 'A2', prompt: 'a2' })
    expect(updated.ok).toBe(true)
    expect(updated.ok && updated.value?.updatedAt).toBe(Date.parse('2026-11-27T01:00:00Z'))
    expect(m.updatePersona(first.value.id, { name: 'b', prompt: 'a2' })).toEqual({
      ok: false,
      error: 'personaDuplicateName',
    })
    expect(m.updatePersona('missing', { name: 'C', prompt: '' })).toEqual({
      ok: false,
      error: 'personaNotFound',
    })
  })

  it('删除当前人格后启用剩余第一份；最后一份不可删', async () => {
    const m = await load()
    const created = m.createPersona({ name: 'B', prompt: '', makeActive: true })
    if (!created.ok || !created.value) {
      throw new Error('setup failed')
    }
    const activeId = created.value.id
    expect(m.deletePersona(activeId).ok).toBe(true)
    expect(m.usePersonas.getState().activeId).toBe(m.DEFAULT_PERSONA_ID)
    expect(m.deletePersona(m.DEFAULT_PERSONA_ID)).toEqual({
      ok: false,
      error: 'personaLastCannotDelete',
    })
    expect(m.usePersonas.getState().personas).toHaveLength(1)
  })

  it('删除非当前人格不改变当前启用项', async () => {
    const m = await load()
    const created = m.createPersona({ name: 'B', prompt: '' })
    if (!created.ok || !created.value) {
      throw new Error('setup failed')
    }
    m.setActivePersona(created.value.id)
    expect(m.deletePersona(created.value.id).ok).toBe(true)
    expect(m.usePersonas.getState().activeId).toBe(m.DEFAULT_PERSONA_ID)
  })

  it('重置默认人格恢复名称与空设定，被删除后重新创建', async () => {
    const m = await load()
    const created = m.createPersona({ name: 'B', prompt: '', makeActive: true })
    if (!created.ok || !created.value) {
      throw new Error('setup failed')
    }
    m.updatePersona(m.DEFAULT_PERSONA_ID, { name: '改过的默认', prompt: 'x' })
    expect(m.resetDefaultPersona().ok).toBe(true)
    const reset = m.usePersonas.getState().personas.find((p) => p.id === m.DEFAULT_PERSONA_ID)
    expect(reset?.name).toBe(translate('personaDefaultName'))
    expect(reset?.prompt).toBe('')
    m.deletePersona(m.DEFAULT_PERSONA_ID)
    expect(m.usePersonas.getState().personas.some((p) => p.id === m.DEFAULT_PERSONA_ID)).toBe(false)
    expect(m.resetDefaultPersona().ok).toBe(true)
    expect(m.usePersonas.getState().personas.some((p) => p.id === m.DEFAULT_PERSONA_ID)).toBe(true)
  })
})

describe('personas 导入导出', () => {
  it('导出后可重新导入，列表与当前人格恢复', async () => {
    const m = await load()
    const created = m.createPersona({ name: 'B', prompt: 'b', makeActive: true })
    if (!created.ok || !created.value) {
      throw new Error('setup failed')
    }
    const json = m.exportPersonas()
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(1)
    expect(parsed.activeId).toBe(created.value.id)

    localStorage.clear()
    const fresh = m
    expect(fresh.importPersonas(json).ok).toBe(true)
    const state = fresh.usePersonas.getState()
    expect(state.personas.map((p) => p.name)).toContain('B')
    expect(state.activeId).toBe(created.value.id)
  })

  it('非法 JSON、结构错误与重复名称被拒绝且不修改现有数据', async () => {
    const m = await load()
    const before = JSON.stringify(m.usePersonas.getState().personas)
    expect(m.importPersonas('not json')).toEqual({ ok: false, error: 'personaInvalidFile' })
    expect(
      m.importPersonas(JSON.stringify({ version: 1, activeId: 'a', personas: [] }))
    ).toEqual({ ok: false, error: 'personaInvalidFile' })
    expect(
      m.importPersonas(
        JSON.stringify({
          version: 1,
          activeId: 'a',
          personas: [
            { id: 'a', name: '同名', prompt: '', createdAt: 1, updatedAt: 1 },
            { id: 'b', name: '同名', prompt: '', createdAt: 1, updatedAt: 1 },
          ],
        })
      )
    ).toEqual({ ok: false, error: 'personaInvalidFile' })
    expect(JSON.stringify(m.usePersonas.getState().personas)).toBe(before)
  })
})
