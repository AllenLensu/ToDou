import { t } from '../i18n'
import sqlite3InitModule, {
  type Database,
  type SqlValue,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'
import type { SqlRow } from './types'
import { installFieldSyncSchema } from './fieldSyncSchema'
import appPackage from '../../package.json' with { type: 'json' }

// OPFS在内存运行 SQLite，靠导出整库持久化；kvvfs 则由 SQLite 直接写 Web Storage。
export const DATABASE_PERSIST = Symbol('todou.database.persist')
export const DATABASE_STORAGE_KIND = Symbol('todou.database.storageKind')
const DATABASE_FINISH_OPEN = Symbol('todou.database.finishOpen')
const DATABASE_NEEDS_PERSIST = Symbol('todou.database.needsPersist')

export type PersistentDatabase = Database & {
  [DATABASE_PERSIST]?: () => Promise<void>
  [DATABASE_STORAGE_KIND]?: 'opfs' | 'kvvfs'
  [DATABASE_FINISH_OPEN]?: () => Promise<void>
  [DATABASE_NEEDS_PERSIST]?: boolean
}

const CURRENT_SCHEMA_VERSION = 8

export type LocalDatabaseErrorKind = 'unsupported' | 'quota' | 'corrupt' | 'migration' | 'unknown'

/** 统一各本地后端的打开错误，让界面按有限的错误类别提供下一步操作。 */
export class LocalDatabaseError extends Error {
  readonly kind: LocalDatabaseErrorKind
  readonly cause: unknown

  constructor(kind: LocalDatabaseErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'LocalDatabaseError'
    this.kind = kind
    this.cause = cause
  }
}

const rawErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const errorKindFor = (message: string): LocalDatabaseErrorKind => {
  const normalized = message.toLocaleLowerCase()
  if (/quota|storage.*full|exceed|容量|空间不足|too large/.test(normalized)) return 'quota'
  if (/malformed|corrupt|not a database|database disk image|损坏|完整性/.test(normalized)) return 'corrupt'
  if (/迁移|migration|schema|higher than current|newer than the supported version|版本/.test(normalized)) return 'migration'
  if (/可持久化|persist|kvvfs|storage.*support|不支持/.test(normalized)) return 'unsupported'
  return 'unknown'
}

const userMessageFor = (kind: LocalDatabaseErrorKind, detail: string) => {
  switch (kind) {
    case 'unsupported':
      return t('当前浏览器无法提供可持久化的本地数据库，请使用 Chrome 或 ego browser，并检查站点存储权限。')
    case 'quota':
      return t('浏览器本地存储空间不足，请删除不需要的站点数据后重试。')
    case 'corrupt':
      return t('本地数据库无法读取，可能已损坏。请保留现有数据和升级前副本，重新加载后重试；仍失败时请使用可用的本地导出或升级前副本恢复。')
    case 'migration':
      return t('本地数据库升级失败：{0} 请重新加载后重试。', detail)
    default:
      return t('本地数据库初始化失败：{0}', detail)
  }
}

export const toLocalDatabaseError = (error: unknown): LocalDatabaseError => {
  if (error instanceof LocalDatabaseError) return error
  const detail = rawErrorMessage(error)
  const kind = errorKindFor(detail)
  return new LocalDatabaseError(kind, userMessageFor(kind, detail), error)
}

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    url TEXT,
    priority TEXT NOT NULL DEFAULT 'none',
    status TEXT NOT NULL DEFAULT 'todo'
      CHECK (status IN ('todo', 'in_progress', 'waiting', 'paused', 'completed', 'cancelled')),
    due_at TEXT,
    remind_at TEXT,
    category_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_active_updated
    ON tasks (deleted_at, updated_at DESC);
`

const V2_SCHEMA = `
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
  CREATE TABLE IF NOT EXISTS task_history (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    snapshot_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_task_history_task_created
    ON task_history(task_id, created_at DESC);
`

const V3_SCHEMA = `
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id, deleted_at, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON tasks(recurrence_series_id, occurrence_at);
  CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    remind_at TEXT,
    recurrence_rule TEXT,
    recurrence_mode TEXT NOT NULL DEFAULT 'independent'
      CHECK (recurrence_mode IN ('independent', 'follow_task')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_checklist_items_task
    ON checklist_items(task_id, deleted_at, updated_at DESC);
  CREATE TABLE IF NOT EXISTS task_relations (
    task_id TEXT NOT NULL,
    related_task_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'related',
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, related_task_id),
    CHECK (task_id <> related_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (related_task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_task_relations_related ON task_relations(related_task_id);
  CREATE TABLE IF NOT EXISTS task_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`

const V4_SCHEMA = `
  CREATE INDEX IF NOT EXISTS idx_task_relations_updated
    ON task_relations(updated_at, deleted_at);
`

const V6_SCHEMA = `
  CREATE INDEX IF NOT EXISTS idx_task_settings_updated
    ON task_settings(updated_at, key);
`

export const rowsFor = (db: Database, sql: string, bind?: Record<string, SqlValue | undefined>) =>
  db.exec({
    sql,
    ...(bind ? { bind } : {}),
    rowMode: 'object',
    returnValue: 'resultRows',
  }) as unknown as SqlRow[]

const hasColumn = (db: Database, table: string, column: string) =>
  rowsFor(db, `PRAGMA table_info(${table})`).some((row) => String(row.name ?? '') === column)

const readSchemaVersion = (db: Database) => {
  const row = rowsFor(db, "SELECT value FROM schema_meta WHERE key = 'version'")[0]
  const version = Number.parseInt(String(row?.value ?? '1'), 10)
  return Number.isFinite(version) ? version : 1
}

const writeSchemaVersion = (db: Database, version: number) => {
  db.exec({
    sql: `INSERT INTO schema_meta (key, value) VALUES ('version', $version)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    bind: { '$version': String(version) },
  })
}

export const migrateTaskDatabase = (db: Database) => {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(BASE_SCHEMA)
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)')
  if (!rowsFor(db, "SELECT value FROM schema_meta WHERE key = 'version'")[0]) writeSchemaVersion(db, 1)

  const version = readSchemaVersion(db)
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(t('本地数据库版本 {0} 高于当前应用支持的版本 {1}', version, CURRENT_SCHEMA_VERSION))
  }
  // 历史版本逐段提交，并非整个迁移共用一笔事务；结构变更和对应 schema 标记在同一段内提交。
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!hasColumn(db, 'tasks', 'category_id')) db.exec('ALTER TABLE tasks ADD COLUMN category_id TEXT')
      db.exec(V2_SCHEMA)
      writeSchemaVersion(db, 2)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep the migration error */ }
      throw error
    }
  }
  if (readSchemaVersion(db) < 3) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!hasColumn(db, 'tasks', 'parent_task_id')) db.exec('ALTER TABLE tasks ADD COLUMN parent_task_id TEXT')
      if (!hasColumn(db, 'tasks', 'recurrence_rule')) db.exec('ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT')
      if (!hasColumn(db, 'tasks', 'recurrence_series_id')) db.exec('ALTER TABLE tasks ADD COLUMN recurrence_series_id TEXT')
      if (!hasColumn(db, 'tasks', 'occurrence_at')) db.exec('ALTER TABLE tasks ADD COLUMN occurrence_at TEXT')
      if (!hasColumn(db, 'tasks', 'completion_strategy')) db.exec('ALTER TABLE tasks ADD COLUMN completion_strategy TEXT')
      if (!hasColumn(db, 'categories', 'completion_strategy')) db.exec('ALTER TABLE categories ADD COLUMN completion_strategy TEXT')
      db.exec(V3_SCHEMA)
      writeSchemaVersion(db, 3)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep the migration error */ }
      throw error
    }
  }
  if (readSchemaVersion(db) < 4) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!hasColumn(db, 'task_relations', 'updated_at')) db.exec('ALTER TABLE task_relations ADD COLUMN updated_at TEXT')
      if (!hasColumn(db, 'task_relations', 'deleted_at')) db.exec('ALTER TABLE task_relations ADD COLUMN deleted_at TEXT')
      db.exec("UPDATE task_relations SET updated_at = created_at WHERE updated_at IS NULL")
      db.exec(V4_SCHEMA)
      writeSchemaVersion(db, 4)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep the migration error */ }
      throw error
    }
  }
  if (readSchemaVersion(db) < 5) {
    db.exec('BEGIN IMMEDIATE')
    try {
      // v5 的附件迁移仅为兼容历史：新库只推进版本，不创建附件表；
      // 已有旧表保持原样，避免打开数据库时丢弃旧数据，不代表当前支持附件。
      writeSchemaVersion(db, 5)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep the migration error */ }
      throw error
    }
  }
  if (readSchemaVersion(db) < 6) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!hasColumn(db, 'task_settings', 'updated_at')) {
        db.exec("ALTER TABLE task_settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'")
      }
      db.exec(V6_SCHEMA)
      writeSchemaVersion(db, 6)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep the migration error */ }
      throw error
    }
  }
  if (readSchemaVersion(db) < 7) {
    db.exec('BEGIN IMMEDIATE')
    try {
      // 任务级提醒配置存为 JSON；NULL 表示继续使用已保存的默认配置。
      if (!hasColumn(db, 'tasks', 'reminder_settings')) db.exec('ALTER TABLE tasks ADD COLUMN reminder_settings TEXT')
      writeSchemaVersion(db, 7)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep the migration error */ }
      throw error
    }
  }
  if (readSchemaVersion(db) < 8) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!hasColumn(db, 'categories', 'follow_up_minutes')) db.exec('ALTER TABLE categories ADD COLUMN follow_up_minutes INTEGER')
      writeSchemaVersion(db, 8)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* keep migration failure */ }
      throw error
    }
  }
  if (!hasColumn(db, 'categories', 'follow_up_minutes')) db.exec('ALTER TABLE categories ADD COLUMN follow_up_minutes INTEGER')
  installFieldSyncSchema(db)
  // 补齐曾中断初始化的旧库；不能只凭版本号认定这些列和索引已经存在。
  if (!hasColumn(db, 'categories', 'completion_strategy')) {
    db.exec('ALTER TABLE categories ADD COLUMN completion_strategy TEXT')
  }
  if (!hasColumn(db, 'task_relations', 'updated_at')) db.exec('ALTER TABLE task_relations ADD COLUMN updated_at TEXT')
  if (!hasColumn(db, 'task_relations', 'deleted_at')) db.exec('ALTER TABLE task_relations ADD COLUMN deleted_at TEXT')
  db.exec("UPDATE task_relations SET updated_at = created_at WHERE updated_at IS NULL")
  db.exec(V3_SCHEMA)
  db.exec(V4_SCHEMA)
  if (!hasColumn(db, 'task_settings', 'updated_at')) {
    db.exec("ALTER TABLE task_settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'")
  }
  db.exec(V6_SCHEMA)
  if (!hasColumn(db, 'tasks', 'reminder_settings')) db.exec('ALTER TABLE tasks ADD COLUMN reminder_settings TEXT')
  if (readSchemaVersion(db) !== CURRENT_SCHEMA_VERSION) throw new Error(t('本地数据库迁移未完成'))
}

const createDatabase = (sqlite3: Sqlite3Static): Database => {
  if (sqlite3.oo1.JsStorageDb) return new sqlite3.oo1.JsStorageDb('local')
  throw new Error(t('当前浏览器不支持可持久化的 SQLite WASM 存储'))
}

const OPFS_DATABASE_FILE = 'todou.sqlite3'

const opfsDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  return navigator.storage.getDirectory()
}

const readOpfsDatabase = async (directory: FileSystemDirectoryHandle, name = OPFS_DATABASE_FILE): Promise<Uint8Array | null> => {
  try {
    const handle = await directory.getFileHandle(name)
    return new Uint8Array(await (await handle.getFile()).arrayBuffer())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

/** close 才提交字节；write 或 close 失败时 abort，并继续抛出最初的错误。 */
export const writeOpfsFile = async (directory: FileSystemDirectoryHandle, name: string, bytes: Uint8Array) => {
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    await writable.close()
  } catch (error) {
    try { await writable.abort() } catch { /* preserve the original error */ }
    throw error
  }
}

/** 应用版本变化时先留原镜像；返回的回调须在迁移及必要落盘成功后才写版本标记。 */
export const prepareOpfsAppUpgrade = async (
  directory: FileSystemDirectoryHandle,
  existing: Uint8Array | null,
  version: string,
): Promise<() => Promise<void>> => {
  const markerBytes = await readOpfsDatabase(directory, 'todou.app-version')
  const marker = markerBytes === null ? null : new TextDecoder().decode(markerBytes)
  if (marker !== version && existing !== null) {
    const safeVersion = version.replace(/[^A-Za-z0-9_.-]/g, '-')
    await writeOpfsFile(directory, `todou.before-app-${safeVersion}-${Date.now()}.sqlite3`, existing)
  }
  return async () => {
    if (marker !== version) await writeOpfsFile(directory, 'todou.app-version', new TextEncoder().encode(version))
  }
}

/** 串行导出并持久化；导出或写入失败会使此队列后续调用拒绝写入，须重开数据库重建队列。 */
export const createSerialDatabasePersistence = (
  snapshot: () => Uint8Array,
  write: (bytes: Uint8Array) => Promise<void>,
) => {
  let pending = Promise.resolve()
  let failure: unknown = null
  let hasFailed = false
  return (): Promise<void> => {
    const next = pending.then(async () => {
      if (hasFailed) throw new Error(t('本地保存已暂停。请先保留草稿并重新打开最后成功保存的数据，再重试。'), { cause: failure })
      try {
        await write(snapshot())
      } catch (error) {
        failure = error
        hasFailed = true
        throw error
      }
    })
    pending = next.catch(() => undefined)
    return next
  }
}

const needsUpgrade = (db: Database) => {
  const hasMetadata = rowsFor(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").length > 0
  if (!hasMetadata || readSchemaVersion(db) < CURRENT_SCHEMA_VERSION) return true
  // 本地导出格式为 8；同步元数据单独演进，同应用版本缺少该表时也需先留升级副本。
  return rowsFor(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_meta'").length === 0
}

export const restoreSerializedDatabase = (sqlite3: Sqlite3Static, bytes: Uint8Array): Database => {
  const db = new sqlite3.oo1.DB(':memory:')
  try {
    const pointer = sqlite3.wasm.allocFromTypedArray(bytes)
    const result = sqlite3.capi.sqlite3_deserialize(
      db,
      'main',
      pointer,
      bytes.byteLength,
      bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    )
    if (result !== sqlite3.capi.SQLITE_OK) throw new Error(t('OPFS 数据库读取失败（SQLite {0}）', result))
    return db
  } catch (error) {
    try { db.close() } catch { /* preserve allocation/deserialization failure */ }
    throw error
  }
}

export const openOpfsDatabase = async (sqlite3: Sqlite3Static, directory: FileSystemDirectoryHandle): Promise<PersistentDatabase> => {
  const existing = await readOpfsDatabase(directory)
  const finishOpen = await prepareOpfsAppUpgrade(directory, existing, appPackage.version)
  let db: PersistentDatabase | null = null
  try {
    if (existing && existing.byteLength > 0) {
      db = restoreSerializedDatabase(sqlite3, existing) as PersistentDatabase
    } else {
      // 没有非空 OPFS 主文件时从旧 kvvfs 导出；不删除旧存储，成功落盘后下次优先读 OPFS。
      const legacy = sqlite3.oo1.JsStorageDb ? new sqlite3.oo1.JsStorageDb('local') : null
      if (legacy) {
        let restoreFailed = false
        try {
          db = restoreSerializedDatabase(sqlite3, sqlite3.capi.sqlite3_js_db_export(legacy)) as PersistentDatabase
        } catch (error) {
          restoreFailed = true
          throw error
        } finally {
          try { legacy.close() } catch (error) { if (!restoreFailed) throw error }
        }
      } else {
        db = new sqlite3.oo1.DB(':memory:') as PersistentDatabase
      }
    }
    // 在调用方执行迁移前保存 schema 副本；应用版本副本与 schema 副本各自判断，可能同时保留。
    if (needsUpgrade(db) && (existing?.length || rowsFor(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").length)) {
      const beforeUpgrade = existing?.byteLength ? existing : sqlite3.capi.sqlite3_js_db_export(db)
      await writeOpfsFile(directory, `todou.before-schema-${CURRENT_SCHEMA_VERSION}-${Date.now()}.sqlite3`, beforeUpgrade)
    }
    const ready = db
    ready[DATABASE_STORAGE_KIND] = 'opfs'
    ready[DATABASE_FINISH_OPEN] = finishOpen
    ready[DATABASE_NEEDS_PERSIST] = !existing?.byteLength
    ready[DATABASE_PERSIST] = createSerialDatabasePersistence(
      () => sqlite3.capi.sqlite3_js_db_export(ready),
      (bytes) => writeOpfsFile(directory, OPFS_DATABASE_FILE, bytes),
    )
    return ready
  } catch (error) {
    try { db?.close() } catch { /* preserve inspection/backup/binding failure */ }
    throw error
  }
}

/** 按 OPFS／kvvfs 选择后端；迁移及所需持久化完成后才返回可用数据库。 */
export const openTaskDatabase = async (): Promise<PersistentDatabase> => {
  let db: Database | null = null
  try {
    const sqlite3 = (await sqlite3InitModule()) as Sqlite3Static
    const directory = await opfsDirectory()
    db = directory ? await openOpfsDatabase(sqlite3, directory) : createDatabase(sqlite3)
    if (!(DATABASE_STORAGE_KIND in db)) (db as PersistentDatabase)[DATABASE_STORAGE_KIND] = 'kvvfs'
    const beforeChanges = rowsFor(db, 'SELECT total_changes() AS count')[0]?.count
    const beforeSchema = rowsFor(db, 'PRAGMA schema_version')[0]?.schema_version
    migrateTaskDatabase(db)
    const persistent = db as PersistentDatabase
    const changed = beforeChanges !== rowsFor(db, 'SELECT total_changes() AS count')[0]?.count
      || beforeSchema !== rowsFor(db, 'PRAGMA schema_version')[0]?.schema_version
    // 文件型后端的 COMMIT 只更新内存，还需整库落盘；kvvfs 已由自身 VFS 持久化，无此钩子。
    if ((changed || persistent[DATABASE_NEEDS_PERSIST]) && persistent[DATABASE_PERSIST]) await persistent[DATABASE_PERSIST]()
    if (persistent[DATABASE_FINISH_OPEN]) await persistent[DATABASE_FINISH_OPEN]()
    return persistent
  } catch (error) {
    try { db?.close() } catch { /* preserve the initialization error */ }
    throw toLocalDatabaseError(error)
  }
}
