import type { Database } from '@sqlite.org/sqlite-wasm'

/** 本机同步元数据独立建表，不进入带版本的本地 JSON 导出格式，也不保存网盘凭据。 */
export function installFieldSyncSchema(db: Database) {
  db.exec('SAVEPOINT install_field_sync')
  try {
    // 字段寄存器变动为各目录标记待传；outbox 先引用寄存器，首次再改时才保存发送前版本。
    // 这些触发器随数据库持久化，与连接级的业务前像捕获 TEMP 触发器职责不同。
    db.exec(`
    CREATE TABLE IF NOT EXISTS sync_fields (
      key TEXT PRIMARY KEY, versions TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS sync_conflicts ON sync_fields(key) WHERE json_array_length(versions)>1;
    CREATE TABLE IF NOT EXISTS sync_devices (
      scope TEXT PRIMARY KEY, generation TEXT NOT NULL, last_success TEXT, paused INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sync_pending (
      scope TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(scope, key)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sync_outbox (
      scope TEXT NOT NULL, key TEXT NOT NULL, held_versions TEXT, PRIMARY KEY(scope, key)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS sync_outbox_live_keys ON sync_outbox(key) WHERE held_versions IS NULL;
    CREATE TABLE IF NOT EXISTS sync_seen (
      scope TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(scope, name)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY) WITHOUT ROWID;
    CREATE TRIGGER IF NOT EXISTS sync_field_insert AFTER INSERT ON sync_fields BEGIN
      INSERT INTO sync_pending SELECT scope,NEW.key FROM sync_devices WHERE true ON CONFLICT DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS sync_field_update AFTER UPDATE ON sync_fields BEGIN
      INSERT INTO sync_pending SELECT scope,NEW.key FROM sync_devices WHERE true ON CONFLICT DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS sync_preserve_outbox BEFORE UPDATE OF versions ON sync_fields BEGIN
      UPDATE sync_outbox SET held_versions=OLD.versions WHERE key=OLD.key AND held_versions IS NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS sync_scope_insert AFTER INSERT ON sync_devices BEGIN
      INSERT INTO sync_pending SELECT NEW.scope,key FROM sync_fields WHERE true ON CONFLICT DO NOTHING;
    END;
    `)
    db.exec('RELEASE install_field_sync')
  } catch (error) {
    db.exec('ROLLBACK TO install_field_sync; RELEASE install_field_sync')
    throw error
  }
}

/** 在替换事务或隔离恢复镜像中清空旧交换状态、更新代次并暂停同步，使旧在途确认失效。 */
export function pauseRestoredFieldSync(db: Database) {
  db.exec(`DELETE FROM sync_outbox;
    DELETE FROM sync_fields;
    DELETE FROM sync_pending;
    DELETE FROM sync_seen;
    DELETE FROM sync_meta;
    INSERT INTO sync_meta VALUES ('restored');
    UPDATE sync_devices SET paused = 1, last_success = NULL, generation = lower(hex(randomblob(16)));`)
}
