import { t } from '../i18n'
/** 页面使用数据库期间保持锁回调存活；显式释放或页面关闭后，其他同源窗口才能接管。 */
export interface WindowLease {
  release: () => void
}

export const DATABASE_WINDOW_LOCK = 'todou.local-database.session'

// Only this empty IndexedDB database is used for the lease. Its open connection
// keeps the browser from deleting it until the owning page closes or releases it.
function acquireIndexedDbLease(): Promise<WindowLease | null> {
  return new Promise((resolve, reject) => {
    const probe = new Worker(new URL('./windowLeaseProbe.ts', import.meta.url))
    probe.onerror = event => {
      probe.terminate()
      reject(new Error(event.message || t('无法访问浏览器存储。请允许此站点保存本地数据，然后重试。')))
    }
    probe.onmessage = ({ data }) => {
      // Terminating a blocked probe also discards its queued delete request.
      probe.terminate()
      if (data === 'busy') return resolve(null)
      if (data !== 'available') return reject(new Error(t('无法访问浏览器存储。请允许此站点保存本地数据，然后重试。')))
      let open: IDBOpenDBRequest
      try { open = indexedDB.open(DATABASE_WINDOW_LOCK) } catch (error) { reject(error); return }
      let created = false
      open.onupgradeneeded = () => { created = true }
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        // Two probes can both finish before either page opens the database.
        // IndexedDB serializes creation, so only its creator may mount SQLite.
        if (!created) { db.close(); resolve(null); return }
        resolve({ release: () => db.close() })
      }
    }
    probe.postMessage(DATABASE_WINDOW_LOCK)
  })
}

export const acquireWindowLease = (
  locks: Pick<LockManager, 'request'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks,
): Promise<WindowLease | null> => {
  if (!locks) return acquireIndexedDbLease()
  return new Promise((resolve, reject) => {
    void locks.request(DATABASE_WINDOW_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(null)
        return
      }
      // 返回租约不等于结束回调；内部 Promise 必须等到 release 才完成。
      await new Promise<void>((release) => resolve({ release }))
    }).catch(reject)
  })
}
