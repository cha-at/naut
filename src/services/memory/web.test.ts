import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { MEMORY_TEMPLATES } from './templates.js'
import { resetWebMemoryDatabase, webMemoryAdapter } from './web.js'
import { memoryService } from './index.js'
import { sha256 } from './hash.js'
import { utf8ByteLength } from './text.js'

const adapter = webMemoryAdapter

beforeEach(async () => {
  await resetWebMemoryDatabase()
})

describe('Web 记忆适配器：文档与列表', () => {
  it('首次读取按模板创建，列表固定两份并标注记忆文件', async () => {
    const user = await adapter.read('USER.md')
    expect(user.content).toBe(MEMORY_TEMPLATES['USER.md'].replace(/\n$/, ''))
    expect(user.isMemory).toBe(true)
    expect(user.hash).toHaveLength(64)
    const list = await adapter.list()
    expect(list.entries.map((entry) => entry.name)).toEqual(['USER.md', 'MEMORY.md'])
    expect(list.truncated).toBe(false)
    expect(list.entries.every((entry) => entry.isMemory)).toBe(true)
  })

  it('paths 返回浏览器本地存储语义，门面在非 Tauri 环境选择 Web 适配器', async () => {
    const paths = await adapter.paths()
    expect(paths).toEqual({
      root: null,
      platform: 'web',
      files: [
        { name: 'USER.md', path: null, isMemory: true },
        { name: 'MEMORY.md', path: null, isMemory: true },
      ],
    })
    expect(memoryService.kind).toBe('web')
    expect(memoryService.isNative()).toBe(false)
  })

  it('Web 端不允许新建、重命名、删除', async () => {
    await expect(adapter.create('notes.md')).rejects.toMatchObject({ code: 'read_only' })
    await expect(adapter.rename('USER.md', 'A.md')).rejects.toMatchObject({ code: 'read_only' })
    await expect(adapter.remove('USER.md')).rejects.toMatchObject({ code: 'read_only' })
  })

  it('只接受两份固定文档', async () => {
    await expect(adapter.read('notes.md')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('Web 记忆适配器：读写', () => {
  it('保存后读取到最新内容与哈希，并清除撤销备份', async () => {
    await adapter.edit('MEMORY.md', '长期记忆', '长期记忆（改）', false, 'tool-1')
    expect((await adapter.backupState('MEMORY.md')).available).toBe(true)
    const before = await adapter.read('MEMORY.md')
    const saved = await adapter.write('MEMORY.md', '新的内容\r\n第二行', before.hash ?? undefined)
    expect(saved.content).toBe('新的内容\n第二行')
    expect(saved.hash).toBe(await sha256('新的内容\n第二行'))
    expect((await adapter.read('MEMORY.md')).content).toBe('新的内容\n第二行')
    expect((await adapter.backupState('MEMORY.md')).available).toBe(false)
  })

  it('expectedHash 不一致返回 conflict 并保留原内容', async () => {
    await adapter.write('USER.md', 'v1')
    await adapter.write('USER.md', 'v2')
    await expect(adapter.write('USER.md', 'v3', await sha256('v1'))).rejects.toMatchObject({
      code: 'conflict',
    })
    expect((await adapter.read('USER.md')).content).toBe('v2')
  })

  it('超过 64 KiB 拒绝写入', async () => {
    const huge = 'x'.repeat(64 * 1024 + 1)
    await expect(adapter.write('USER.md', huge)).rejects.toMatchObject({ code: 'too_large' })
    expect((await adapter.read('USER.md')).content).toBe(MEMORY_TEMPLATES['USER.md'].replace(/\n$/, ''))
  })
})

describe('Web 记忆适配器：edit', () => {
  it('唯一匹配替换成功，返回替换处数与备份', async () => {
    await adapter.write('MEMORY.md', '第一行\n偏好：深色主题\n第三行')
    const outcome = await adapter.edit('MEMORY.md', '偏好：深色主题', '偏好：浅色主题', false, 'tool-1')
    expect(outcome.replacements).toBe(1)
    expect(outcome.backupId).toBeTruthy()
    expect((await adapter.read('MEMORY.md')).content).toBe('第一行\n偏好：浅色主题\n第三行')
    const backup = await adapter.backupState('MEMORY.md')
    expect(backup.available).toBe(true)
    expect(backup.backupId).toBe(outcome.backupId)
    expect(backup.editedHash).toBe(outcome.hash)
  })

  it('零匹配与多处匹配（replace_all=false）都返回 no_match 且不修改文件', async () => {
    await adapter.write('USER.md', 'a a a')
    await expect(adapter.edit('USER.md', 'zzz', 'b', false, 't')).rejects.toMatchObject({
      code: 'no_match',
    })
    await expect(adapter.edit('USER.md', 'a', 'b', false, 't')).rejects.toMatchObject({
      code: 'no_match',
    })
    expect((await adapter.read('USER.md')).content).toBe('a a a')
    expect((await adapter.backupState('USER.md')).available).toBe(false)
  })

  it('replace_all 替换全部匹配', async () => {
    await adapter.write('USER.md', 'a a a')
    const outcome = await adapter.edit('USER.md', 'a', 'b', true, 't')
    expect(outcome.replacements).toBe(3)
    expect((await adapter.read('USER.md')).content).toBe('b b b')
  })

  it('old_string 为空返回 invalid_argument；相同文本不写盘也不建备份', async () => {
    await expect(adapter.edit('USER.md', '', 'x', false, 't')).rejects.toMatchObject({
      code: 'invalid_argument',
    })
    const outcome = await adapter.edit('USER.md', 'USER.md', 'USER.md', false, 't')
    expect(outcome.replacements).toBe(0)
    expect(outcome.backupId).toBeUndefined()
    expect((await adapter.backupState('USER.md')).available).toBe(false)
  })

  it('写入后超过 64 KiB 返回 too_large 且文件不变', async () => {
    const content = `a${'x'.repeat(64 * 1024 - 1)}`
    await adapter.write('USER.md', content)
    await expect(adapter.edit('USER.md', 'a', 'aa', false, 't')).rejects.toMatchObject({
      code: 'too_large',
    })
    expect((await adapter.read('USER.md')).size).toBe(64 * 1024)
  })

  it('CRLF 归一化后仍按字面匹配', async () => {
    await adapter.write('MEMORY.md', '第一行\r\n第二行\r\n')
    await adapter.edit('MEMORY.md', '第一行\n第二行', '第一行\n第二行\n第三行', false, 't')
    expect((await adapter.read('MEMORY.md')).content).toBe('第一行\n第二行\n第三行')
  })

  it('并发编辑按文件串行执行，后一次看到前一次结果', async () => {
    await adapter.write('USER.md', 'a\nb\nc')
    await Promise.all([
      adapter.edit('USER.md', 'a', 'A', false, 't1'),
      adapter.edit('USER.md', 'c', 'C', false, 't2'),
    ])
    expect((await adapter.read('USER.md')).content).toBe('A\nb\nC')
  })
})

describe('Web 记忆适配器：撤销', () => {
  it('撤销恢复编辑前内容并删除备份', async () => {
    await adapter.write('USER.md', '旧内容')
    await adapter.edit('USER.md', '旧内容', '新内容', false, 't1')
    const restored = await adapter.undo('USER.md')
    expect(restored.content).toBe('旧内容')
    expect((await adapter.read('USER.md')).content).toBe('旧内容')
    expect((await adapter.backupState('USER.md')).available).toBe(false)
    await expect(adapter.undo('USER.md')).rejects.toMatchObject({ code: 'no_backup' })
  })

  it('连续两次编辑只保留最后一次的备份', async () => {
    await adapter.write('USER.md', 'v1')
    await adapter.edit('USER.md', 'v1', 'v2', false, 't1')
    await adapter.edit('USER.md', 'v2', 'v3', false, 't2')
    await adapter.undo('USER.md')
    expect((await adapter.read('USER.md')).content).toBe('v2')
    await expect(adapter.undo('USER.md')).rejects.toMatchObject({ code: 'no_backup' })
  })

  it('编辑后用户再保存，旧备份失效', async () => {
    await adapter.write('USER.md', 'v1')
    await adapter.edit('USER.md', 'v1', 'v2', false, 't1')
    await adapter.write('USER.md', 'v3')
    await expect(adapter.undo('USER.md')).rejects.toMatchObject({ code: 'no_backup' })
  })

  it('外部修改后撤销返回 backup_stale，不覆盖用户内容', async () => {
    await adapter.write('USER.md', 'v1')
    await adapter.edit('USER.md', 'v1', 'v2', false, 't1')
    await adapter.write('USER.md', '用户手动修改')
    // 手动写会清除备份；再构造一个哈希不一致的备份场景
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('naut-memory')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const staleHash = await sha256('v2')
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite')
      tx.objectStore('backups').put({
        name: 'USER.md',
        content: 'v1',
        editedHash: staleHash,
        editedAt: Date.now(),
        backupId: 'stale',
        toolUseId: 't1',
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    await expect(adapter.undo('USER.md')).rejects.toMatchObject({ code: 'backup_stale' })
    expect((await adapter.read('USER.md')).content).toBe('用户手动修改')
  })
})

describe('记忆快照', () => {
  it('两份记忆并发读取，超过 16 KiB 按行截断并标记', async () => {
    const long = Array.from(
      { length: 900 },
      (_, index) => `第 ${index + 1} 行：用于测试截断的偏好与资料内容`
    ).join('\n')
    await adapter.write('USER.md', long)
    const snapshot = await memoryService.readSnapshot()
    expect(snapshot.user.length).toBeGreaterThan(0)
    expect(snapshot.userTruncated).toBe(true)
    expect(utf8ByteLength(snapshot.user)).toBeLessThanOrEqual(16 * 1024)
    expect(snapshot.memory).toBe(MEMORY_TEMPLATES['MEMORY.md'].replace(/\n$/, ''))
    expect(snapshot.memoryTruncated).toBe(false)
    expect(snapshot.capturedAt).toBeGreaterThan(0)
  })
})
