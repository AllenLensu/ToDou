import { newId } from './transform'
import { t } from '../i18n'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { migrateTaskDatabase, rowsFor, writeOpfsFile } from './database'
import { createTaskStoreFromDatabase } from './taskStore'
import { parseLocalDataExport, validateLocalSnapshot } from '../application/localDataTransfer'
import type { LocalDataExport } from './types'
import { restoreMetaKey, type RestoreBinding } from '../sync/sharedRestore'
import { pauseRestoredFieldSync } from './fieldSyncSchema'
import { createKvvfsRecoveryStorage, indexedRecoveryCopies } from './kvvfsRecovery'

export type LocalRecoveryCopy = { name: string; byteLength: number }
export type LocalRecoveryResult = { preservedCopy: string | null }

/** 只接受应用生成的副本名；各后端另在当前站点／应用自己的数据目录中定位文件。 */
export const isLocalRecoveryCopyName = (name: string) =>
  /^todou\.before-(?:schema-\d+|app-[A-Za-z0-9_.-]+|recovery)-\d+(?:-[a-fA-F0-9-]+)?\.sqlite3$/.test(name)

export interface RecoveryStorage {
  list(): Promise<LocalRecoveryCopy[]>
  readCopy(name: string): Promise<Uint8Array>
  /** 候选镜像由上层先校验；后端须先保留现有数据，副本保存失败则不得开始替换。 */
  replace(bytes: Uint8Array): Promise<LocalRecoveryResult>
}

export const createOpfsRecoveryStorage = (directory: FileSystemDirectoryHandle): RecoveryStorage => ({
  async list() {
    const entries: LocalRecoveryCopy[] = []
    const iterable = directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }
    for await (const [name, handle] of iterable.entries()) {
      if (handle.kind !== 'file' || !isLocalRecoveryCopyName(name)) continue
      const file = await (handle as FileSystemFileHandle).getFile()
      entries.push({ name, byteLength: file.size })
    }
    return entries.sort((a, b) => b.name.localeCompare(a.name))
  },
  async readCopy(name) {
    if (!isLocalRecoveryCopyName(name)) throw new Error(t('请选择当前应用列出的本地副本'))
    return new Uint8Array(await (await (await directory.getFileHandle(name)).getFile()).arrayBuffer())
  },
  async replace(bytes) {
    let previous: File | null = null
    try { previous = await (await directory.getFileHandle('todou.sqlite3')).getFile() } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
    }
    let preservedCopy: string | null = null
    if (previous !== null) {
      preservedCopy = `todou.before-recovery-${Date.now()}-${newId()}.sqlite3`
      await writeOpfsFile(directory, preservedCopy, new Uint8Array(await previous.arrayBuffer()))
    }
    // 先成功保留原始字节（即使旧库损坏），再写主文件；createWritable 在 close 时提交，异常时 abort。
    await writeOpfsFile(directory, 'todou.sqlite3', bytes)
    return { preservedCopy }
  },
})

const localStorage = async (): Promise<RecoveryStorage> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    const sqlite = await sqlite3InitModule()
    if (!sqlite.oo1.JsStorageDb || !globalThis.indexedDB) throw new Error(t('当前环境无法保存恢复前副本，请检查浏览器本地存储权限。'))
    return createKvvfsRecoveryStorage(sqlite, indexedRecoveryCopies(globalThis.indexedDB))
  }
  return createOpfsRecoveryStorage(await navigator.storage.getDirectory())
}

export const listLocalRecoveryCopies = async (): Promise<LocalRecoveryCopy[]> => (await localStorage()).list()

/** 在独立内存库生成替换镜像，不接触失败数据库或仍在使用的存储实例。 */
export const databaseImageFromLocalData = async (data: LocalDataExport, binding?: RestoreBinding): Promise<Uint8Array> => {
  const validated = parseLocalDataExport(JSON.stringify(data))
  const sqlite3 = await sqlite3InitModule()
  const db = new sqlite3.oo1.DB(':memory:')
  migrateTaskDatabase(db)
  const store = createTaskStoreFromDatabase(db)
  try {
    await store.replaceLocalData(validated.snapshot)
    if (binding) db.exec({ sql: 'INSERT INTO sync_meta(key) VALUES ($key)', bind: { '$key': restoreMetaKey(binding) } })
    return sqlite3.capi.sqlite3_js_db_export(db)
  } finally { store.close(); await Promise.resolve() }
}

/** 候选副本只在内存中校验和迁移，暂停其旧同步状态后导出，不直接作为正式库打开。 */
export const validatedRecoveryImage = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const header = new TextDecoder().decode(bytes.subarray(0, 16))
  if (bytes.byteLength < 100 || header !== 'SQLite format 3\0') throw new Error(t('该副本不是可读取的 SQLite 数据库，当前数据未被替换'))
  const sqlite3 = await sqlite3InitModule()
  const db = new sqlite3.oo1.DB(':memory:')
  try {
    const pointer = sqlite3.wasm.allocFromTypedArray(bytes)
    const result = sqlite3.capi.sqlite3_deserialize(db, 'main', pointer, bytes.byteLength, bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE)
    if (result !== sqlite3.capi.SQLITE_OK) throw new Error(t('副本无法读取，当前数据未被替换'))
    const integrity = rowsFor(db, 'PRAGMA integrity_check')
    if (integrity.length !== 1 || Object.values(integrity[0]!).some((value) => value !== 'ok')) throw new Error(t('副本未通过数据库完整性检查，当前数据未被替换'))
    if (rowsFor(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'schema_meta')").length !== 2) throw new Error(t('该副本不是 ToDou 数据库，当前数据未被替换'))
    migrateTaskDatabase(db)
    if (rowsFor(db, 'PRAGMA foreign_key_check').length) throw new Error(t('副本包含无效引用，当前数据未被替换'))
    const store = createTaskStoreFromDatabase(db)
    const snapshot = await store.exportSyncSnapshot()
    // 恢复必须拒绝坏数据：取回原始字段重新校验，不能沿用日常读取时回退默认值／null 的容错。
    const rawTasks = new Map(rowsFor(db, `SELECT id, priority, status, due_at AS dueAt, remind_at AS remindAt,
      occurrence_at AS occurrenceAt, completion_strategy AS completionStrategy, reminder_settings AS reminderSettings
      FROM tasks`).map((row) => [String(row.id), row]))
    for (const task of snapshot.tasks) {
      const raw = rawTasks.get(task.id)!
      const settings = raw.reminderSettings
      Object.assign(task, raw, { reminderSettings: settings === null ? null : JSON.parse(String(settings)) })
    }
    const rawCategories = new Map(rowsFor(db, 'SELECT id, completion_strategy, follow_up_minutes FROM categories').map((row) => [String(row.id), row]))
    for (const category of snapshot.categories) Object.assign(category, { completionStrategy: rawCategories.get(category.id)?.completion_strategy, followUpMinutes: rawCategories.get(category.id)?.follow_up_minutes })
    const rawChecklist = new Map(rowsFor(db, 'SELECT id, completed, recurrence_mode FROM checklist_items').map((row) => [String(row.id), row]))
    for (const item of snapshot.checklistItems) {
      const raw = rawChecklist.get(item.id)!
      if (raw.completed !== 0 && raw.completed !== 1) throw new Error(t('副本中的检查项状态无效，当前数据未被替换'))
      Object.assign(item, { recurrenceMode: raw.recurrence_mode })
    }
    const history = new Map(rowsFor(db, 'SELECT id, snapshot_json FROM task_history').map((row) => [String(row.id), row.snapshot_json]))
    for (const entry of snapshot.history) {
      const raw = history.get(entry.id)
      entry.snapshot = raw === null ? null : JSON.parse(String(raw))
    }
    validateLocalSnapshot(snapshot, 6)
    // 清除旧同步交换状态并暂停设备，避免恢复后的旧内容直接继续同步；不自动替换其他设备的数据。
    pauseRestoredFieldSync(db)
    return sqlite3.capi.sqlite3_js_db_export(db)
  } finally { db.close() }
}

/** 调用方须暂停同步、停止提醒、排空写入并关闭旧库，但持续持有应用窗口锁。 */
export const recoverLocalData = async (data: LocalDataExport, storage?: RecoveryStorage): Promise<LocalRecoveryResult> => {
  const bytes = await databaseImageFromLocalData(data)
  return (storage ?? await localStorage()).replace(bytes)
}

export const recoverSharedData = async (data: LocalDataExport, binding: RestoreBinding, checkDirectory?: () => Promise<void>): Promise<LocalRecoveryResult> => {
  const bytes = await databaseImageFromLocalData(data, binding)
  const target = await localStorage()
  await checkDirectory?.()
  return target.replace(bytes)
}

export const recoverLocalDatabaseCopy = async (name: string, storage?: RecoveryStorage): Promise<LocalRecoveryResult> => {
  if (!isLocalRecoveryCopyName(name)) throw new Error(t('请选择当前应用列出的本地副本'))
  const target = storage ?? await localStorage()
  // 与 JSON 恢复共用上方调用前提；副本全部校验通过后才进入保留旧数据及替换流程。
  const bytes = await validatedRecoveryImage(await target.readCopy(name))
  return target.replace(bytes)
}
