import { newId } from './transform'
import { t } from '../i18n'
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { restoreSerializedDatabase } from './database'
import type { LocalRecoveryCopy, RecoveryStorage } from './recovery'

interface CopyArchive {
  list(): Promise<LocalRecoveryCopy[]>
  readCopy(name: string): Promise<Uint8Array>
  preserve(name: string, bytes: Uint8Array): Promise<void>
}

/** 恢复副本放入 IndexedDB，避开 kvvfs 使用的较小 Web Storage 配额；等事务完成才确认保存。 */
export function indexedRecoveryCopies(factory: IDBFactory): CopyArchive {
  type Copy = { name: string; image: Blob }
  async function request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open('todou-kvvfs-recovery', 1)
      opening.onupgradeneeded = () => opening.result.createObjectStore('copies', { keyPath: 'name' })
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('copies', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined)
        const operation = action(tx.objectStore('copies'))
        tx.oncomplete = () => resolve(operation.result)
        tx.onabort = () => reject(tx.error ?? operation.error ?? new Error(t('恢复副本未保存。')))
      })
    } finally { db.close() }
  }
  return {
    async list() {
      const copies: Copy[] = await request('readonly', store => store.getAll())
      return copies.map(copy => ({ name: copy.name, byteLength: copy.image.size })).sort((a, b) => b.name.localeCompare(a.name))
    },
    async readCopy(name) {
      const copy: Copy | undefined = await request('readonly', store => store.get(name))
      if (!copy) throw new Error(t('找不到该本地恢复副本。'))
      return new Uint8Array(await copy.image.arrayBuffer())
    },
    async preserve(name, bytes) {
      const image = new Blob([new Uint8Array(bytes)])
      await request('readwrite', store => store.add({ name, image }))
    },
  }
}

/** 调用方须持有应用锁、排空并关闭工作区，传入已校验镜像；此处不负责完整内容校验。 */
export function createKvvfsRecoveryStorage(sqlite: Sqlite3Static, copies: CopyArchive): RecoveryStorage {
  return {
    list: () => copies.list(),
    readCopy: name => copies.readCopy(name),
    async replace(bytes) {
      const source = restoreSerializedDatabase(sqlite, bytes)
      const api = sqlite.capi
      try {
        const destination = new sqlite.oo1.JsStorageDb('local')
        try {
          const previous = api.sqlite3_js_db_export(destination)
          const preservedCopy = previous.length ? `todou.before-recovery-${Date.now()}-${newId()}.sqlite3` : null
          // 原镜像进入独立的副本归档后才允许修改 kvvfs；归档失败会直接退出，不尝试替换。
          if (preservedCopy) await copies.preserve(preservedCopy, previous)
          // 经 SQLite backup 写入 JsStorageDb 的 Web Storage，而非把镜像当作单个存储键覆盖。
          const backup = api.sqlite3_backup_init(destination, 'main', source, 'main')
          if (!backup) throw new Error(t('无法开始替换本地数据库：{0}', api.sqlite3_errmsg(destination)))
          let step, finished
          try { step = api.sqlite3_backup_step(backup, -1) }
          finally { finished = api.sqlite3_backup_finish(backup) }
          if (step !== api.SQLITE_DONE || finished !== api.SQLITE_OK) {
            throw new Error(t('替换本地数据库失败：{0}', api.sqlite3_errmsg(destination)))
          }
          return { preservedCopy }
        } finally { destination.close() }
      } finally { source.close() }
    },
  }
}
