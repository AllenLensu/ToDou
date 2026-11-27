import { sha256Hex } from '../domain/contentDigest'
import { newId } from './transform'
import { t } from '../i18n'
import { parseLocalDataExport } from '../application/localDataTransfer'
import type { RemoteFiles } from '../sync/providers/files'
import type { LocalDataExport } from './types'

export type BackupLocation = 'local' | 'webdav'
export type BackupDestination = BackupLocation | 'both'
export type BackupKind = 'manual' | 'auto'
export type BackupFile = { name: string; content: string }

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const pattern = new RegExp('^todou-backup-(auto|manual)-(\\d{13})-(' + uuid + ')-(' + uuid + ')-([a-f0-9]{64})\\.todou\\.json$')

export function backupInfo(name: string) {
  const match = pattern.exec(name)
  return match ? { name, kind: match[1] as BackupKind, time: Number(match[2]), device: match[3]!, digest: match[5]! } : null
}

export async function makeBackup(data: LocalDataExport, kind: BackupKind, device: string): Promise<BackupFile> {
  const content = JSON.stringify(data)
  const name = ['todou-backup', kind, Date.now(), device, newId(), await sha256Hex(content)].join('-') + '.todou.json'
  if (!backupInfo(name)) throw new Error(t('无法识别本机备份标识。'))
  return { name, content }
}

export async function listBackups(files: RemoteFiles) {
  return (await files.list()).map(backupInfo).filter(info => info !== null)
    .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name))
}

export async function readBackup(files: RemoteFiles, name: string) {
  const info = backupInfo(name)
  if (!info) throw new Error(t('请选择备份列表中的文件。'))
  const content = await files.read(name)
  if (!content) throw new Error(t('找不到选中的备份，请刷新列表。'))
  if (await sha256Hex(content) !== info.digest) throw new Error(t('备份内容校验失败，请选择另一份备份。'))
  return content
}

export async function saveBackup(files: RemoteFiles, location: BackupLocation, backup: BackupFile) {
  const info = backupInfo(backup.name)
  if (!info) throw new Error(t('无法识别备份文件。'))
  parseLocalDataExport(backup.content)
  await files.write(backup.name, backup.content)
  await readBackup(files, backup.name)
  if (info.kind !== 'auto') return 'complete'
  // 新副本已验证；后续列表、读取和清理失败都不能让调度器重做这一次备份。
  try {
    const previous = (await listBackups(files)).filter(row =>
      row.kind === 'auto' && row.device === info.device && row.name !== backup.name)
    let remainingToKeep = (location === 'local' ? 3 : 10) - 1
    if (previous.length <= remainingToKeep) return 'complete'
    let skipped = false
    for (const row of previous) {
      try {
        parseLocalDataExport(await readBackup(files, row.name))
      } catch {
        // 不能读取或恢复的副本既不占保留名额，也不能作为删除候选。
        skipped = true
        continue
      }
      if (remainingToKeep > 0) remainingToKeep--
      else await files.remove(row.name)
    }
    return skipped ? 'cleanup-incomplete' : 'complete'
  } catch {
    return 'cleanup-incomplete'
  }
}

// 备份库与待办 SQLite、恢复前副本分别存储；整库恢复不会改写已有备份。
async function localRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('todou-independent-backups', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('files', mode)
      const request = operation(tx.objectStore('files'))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error ?? new Error(t('本机备份写入中断。')))
    })
  } finally { db.close() }
}

export const localBackupFiles: RemoteFiles = {
  async list() { return (await localRequest('readonly', store => store.getAllKeys())).map(String) },
  async read(name) { return await localRequest('readonly', store => store.get(name)) ?? null },
  async write(name, content) { await localRequest('readwrite', store => store.put(content, name)) },
  async remove(name) { await localRequest('readwrite', store => store.delete(name)) },
}
