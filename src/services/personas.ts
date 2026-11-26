import { create } from 'zustand'
import { translate, type TranslationKey } from '../i18n/index.js'
import { createId } from '../utils/id.js'

/**
 * 人格：名称 + 人物设定，全局启用一份当前人格，新对话在首条消息前捕获快照。
 * 存储为 localStorage 的 chat-demo:personas，与设置同级；损坏时回退默认人格并提示。
 */

export const PERSONA_NAME_MAX = 40
export const PERSONA_PROMPT_MAX = 8000
export const PERSONAS_VERSION = 1
export const DEFAULT_PERSONA_ID = 'default-persona'
const STORAGE_KEY = 'chat-demo:personas'
/** 损坏数据的诊断信息：只记录长度与原因，不保留人格正文 */
const CORRUPT_KEY = 'chat-demo:personas:corrupt'

export type Persona = {
  id: string
  name: string
  prompt: string
  createdAt: number
  updatedAt: number
}

export type PersonasData = {
  version: typeof PERSONAS_VERSION
  activeId: string
  personas: Persona[]
}

/** 可展示给用户的校验错误；值直接作为 i18n key */
export type PersonaErrorCode = Extract<
  TranslationKey,
  | 'personaNameRequired'
  | 'personaNameTooLong'
  | 'personaPromptTooLong'
  | 'personaDuplicateName'
  | 'personaLastCannotDelete'
  | 'personaNotFound'
  | 'personaInvalidFile'
>

export type PersonaResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; error: PersonaErrorCode }

type PersonasState = {
  personas: Persona[]
  activeId: string
  /** 上次加载回退了损坏数据；页面提示一次后调用 clearPersonasCorrupt */
  corrupt: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用时只在内存中生效
  }
}

const normalizeName = (name: string) => name.trim()

/** 名称比较不区分大小写；同时用于去重与「设为当前」校验 */
const nameKey = (name: string) => normalizeName(name).toLocaleLowerCase()

export const defaultPersona = (now = Date.now()): Persona => ({
  id: DEFAULT_PERSONA_ID,
  name: translate('personaDefaultName'),
  prompt: '',
  createdAt: now,
  updatedAt: now,
})

export const defaultPersonasData = (): PersonasData => {
  const persona = defaultPersona()
  return { version: PERSONAS_VERSION, activeId: persona.id, personas: [persona] }
}

/** 默认人格置顶，其余按 updatedAt 降序 */
export const sortPersonas = (personas: Persona[]): Persona[] =>
  [...personas].sort((a, b) => {
    const aDefault = a.id === DEFAULT_PERSONA_ID
    const bDefault = b.id === DEFAULT_PERSONA_ID
    if (aDefault !== bDefault) {
      return aDefault ? -1 : 1
    }
    return b.updatedAt - a.updatedAt
  })

const sanitizePersona = (value: unknown): Persona | null => {
  if (!isRecord(value)) {
    return null
  }
  const { id, name, prompt } = value
  if (typeof id !== 'string' || !id || typeof name !== 'string' || typeof prompt !== 'string') {
    return null
  }
  const trimmed = normalizeName(name)
  if (!trimmed || trimmed.length > PERSONA_NAME_MAX || prompt.length > PERSONA_PROMPT_MAX) {
    return null
  }
  const createdAt =
    typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now()
  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : createdAt
  return { id, name: trimmed, prompt, createdAt, updatedAt }
}

/** 结构、版本、id 唯一、名称去重、activeId 有效；任一项不满足即整体判为无效 */
export const sanitizePersonasData = (value: unknown): PersonasData | null => {
  if (!isRecord(value) || value.version !== PERSONAS_VERSION) {
    return null
  }
  if (!Array.isArray(value.personas) || value.personas.length === 0) {
    return null
  }
  const personas: Persona[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const item of value.personas) {
    const persona = sanitizePersona(item)
    if (!persona || ids.has(persona.id) || names.has(nameKey(persona.name))) {
      return null
    }
    ids.add(persona.id)
    names.add(nameKey(persona.name))
    personas.push(persona)
  }
  if (typeof value.activeId !== 'string' || !ids.has(value.activeId)) {
    return null
  }
  return { version: PERSONAS_VERSION, activeId: value.activeId, personas: sortPersonas(personas) }
}

const rememberCorrupt = (raw: string) => {
  try {
    localStorage.setItem(
      CORRUPT_KEY,
      JSON.stringify({ at: Date.now(), length: raw.length, reason: 'invalid-personas' })
    )
  } catch {
    // 诊断信息写不进去不影响回退
  }
}

export const loadPersonas = (): { data: PersonasData; corrupt: boolean } => {
  const raw = read(STORAGE_KEY)
  if (!raw) {
    return { data: defaultPersonasData(), corrupt: false }
  }
  try {
    const data = sanitizePersonasData(JSON.parse(raw))
    if (data) {
      return { data, corrupt: false }
    }
  } catch {
    // 落到损坏回退
  }
  rememberCorrupt(raw)
  return { data: defaultPersonasData(), corrupt: true }
}

export const usePersonas = create<PersonasState>(() => {
  const { data, corrupt } = loadPersonas()
  return { personas: data.personas, activeId: data.activeId, corrupt }
})

export const clearPersonasCorrupt = () => usePersonas.setState({ corrupt: false })

const commit = (personas: Persona[], activeId: string): PersonasData => {
  const data: PersonasData = { version: PERSONAS_VERSION, activeId, personas: sortPersonas(personas) }
  write(STORAGE_KEY, JSON.stringify(data))
  usePersonas.setState({ personas: data.personas, activeId })
  return data
}

const findPersona = (personas: Persona[], id: string) =>
  personas.find((persona) => persona.id === id)

const validateInput = (
  personas: Persona[],
  input: { name: string; prompt: string },
  excludeId?: string
): PersonaErrorCode | null => {
  const name = normalizeName(input.name)
  if (!name) {
    return 'personaNameRequired'
  }
  if (name.length > PERSONA_NAME_MAX) {
    return 'personaNameTooLong'
  }
  if (input.prompt.length > PERSONA_PROMPT_MAX) {
    return 'personaPromptTooLong'
  }
  const key = nameKey(name)
  if (personas.some((persona) => persona.id !== excludeId && nameKey(persona.name) === key)) {
    return 'personaDuplicateName'
  }
  return null
}

export const getActivePersona = (): Persona => {
  const { personas, activeId } = usePersonas.getState()
  return (
    findPersona(personas, activeId) ??
    personas[0] ??
    defaultPersona()
  )
}

/** 新建人格；默认不切换当前人格，只有 makeActive 才启用 */
export const createPersona = (input: {
  name: string
  prompt: string
  makeActive?: boolean
}): PersonaResult<Persona> => {
  const { personas, activeId } = usePersonas.getState()
  const error = validateInput(personas, input)
  if (error) {
    return { ok: false, error }
  }
  const now = Date.now()
  const persona: Persona = {
    id: createId(),
    name: normalizeName(input.name),
    prompt: input.prompt,
    createdAt: now,
    updatedAt: now,
  }
  commit([...personas, persona], input.makeActive ? persona.id : activeId)
  return { ok: true, value: persona }
}

export const updatePersona = (
  id: string,
  input: { name: string; prompt: string }
): PersonaResult<Persona> => {
  const { personas, activeId } = usePersonas.getState()
  if (!findPersona(personas, id)) {
    return { ok: false, error: 'personaNotFound' }
  }
  const error = validateInput(personas, input, id)
  if (error) {
    return { ok: false, error }
  }
  const now = Date.now()
  let updated: Persona | undefined
  const next = personas.map((persona) => {
    if (persona.id !== id) {
      return persona
    }
    updated = {
      ...persona,
      name: normalizeName(input.name),
      prompt: input.prompt,
      updatedAt: now,
    }
    return updated
  })
  commit(next, activeId)
  return updated ? { ok: true, value: updated } : { ok: false, error: 'personaNotFound' }
}

/** 删除人格；最后一份不可删，删除当前人格时自动启用剩余列表的第一份 */
export const deletePersona = (id: string): PersonaResult => {
  const { personas, activeId } = usePersonas.getState()
  if (!findPersona(personas, id)) {
    return { ok: false, error: 'personaNotFound' }
  }
  if (personas.length <= 1) {
    return { ok: false, error: 'personaLastCannotDelete' }
  }
  const next = personas.filter((persona) => persona.id !== id)
  commit(next, activeId === id ? next[0].id : activeId)
  return { ok: true }
}

export const setActivePersona = (id: string): PersonaResult => {
  const { personas, activeId } = usePersonas.getState()
  if (!findPersona(personas, id)) {
    return { ok: false, error: 'personaNotFound' }
  }
  if (activeId !== id) {
    commit(personas, id)
  }
  return { ok: true }
}

/** 重置默认人格；已被删除时重新创建，不改变当前启用项（除非当前项就是它） */
export const resetDefaultPersona = (): PersonaResult => {
  const { personas, activeId } = usePersonas.getState()
  const now = Date.now()
  const existing = findPersona(personas, DEFAULT_PERSONA_ID)
  const name = translate('personaDefaultName')
  // 重置后的名称如果与其他人格重名，先提示，避免破坏唯一性约束
  const error = validateInput(
    personas,
    { name, prompt: '' },
    existing ? DEFAULT_PERSONA_ID : undefined
  )
  if (error) {
    return { ok: false, error }
  }
  if (existing) {
    const next = personas.map((persona) =>
      persona.id === DEFAULT_PERSONA_ID
        ? { ...persona, name, prompt: '', updatedAt: now }
        : persona
    )
    commit(next, activeId)
    return { ok: true }
  }
  const persona: Persona = {
    id: DEFAULT_PERSONA_ID,
    name,
    prompt: '',
    createdAt: now,
    updatedAt: now,
  }
  commit([persona, ...personas], activeId || persona.id)
  return { ok: true }
}

/** 导出全部人格与当前启用项；不含任何其他设置 */
export const exportPersonas = (): string => {
  const { personas, activeId } = usePersonas.getState()
  const data: PersonasData = { version: PERSONAS_VERSION, activeId, personas }
  return JSON.stringify(data, null, 2)
}

/** 只解析与校验导入内容，供确认弹窗之前预检；不修改现有数据 */
export const parsePersonasImport = (raw: string): PersonasData | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return sanitizePersonasData(parsed)
}

/** 应用已校验的人格数据（替换全部人格与当前启用项） */
export const replacePersonas = (data: PersonasData): PersonasData => commit(data.personas, data.activeId)

/** 导入替换全部人格；校验失败不修改现有数据 */
export const importPersonas = (raw: string): PersonaResult<PersonasData> => {
  const data = parsePersonasImport(raw)
  if (!data) {
    return { ok: false, error: 'personaInvalidFile' }
  }
  commit(data.personas, data.activeId)
  return { ok: true, value: data }
}
