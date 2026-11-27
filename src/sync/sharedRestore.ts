import { sha256Hex } from '../domain/contentDigest'
import { t } from '../i18n'
import { parseLocalDataExport } from '../application/localDataTransfer'
import type { LocalDataExport } from '../storage/types'
import type { RemoteFiles } from './providers/files'

const markerPrefix = 'todou-restore-v1-'
const idPattern = /^([0-9]{10})-([a-f0-9]{64})$/
export type RestoreBinding = { scope: string; id: string }
export type RestoreCandidate = { id: string; content: string; previous: string[] }

function parts(id: string) {
  const match = idPattern.exec(id)
  if (!match) throw new Error(t('共享恢复代次无效。'))
  return { sequence: Number(match[1]), digest: match[2]! }
}

export function restoreMetaPrefix(scope: string) { return 'shared-restore:' + JSON.stringify(scope) + ':' }
export function restoreMetaKey(binding: RestoreBinding) {
  parts(binding.id)
  return restoreMetaPrefix(binding.scope) + binding.id
}

export function restoreHeads(names: string[]) {
  const heads: string[] = []
  for (const name of names) {
    if (!name.startsWith('todou-restore-')) continue
    if (!name.startsWith(markerPrefix) || !name.endsWith('.json')) throw new Error(t('当前版本无法读取此共享恢复标记。'))
    const id = name.slice(markerPrefix.length, -5)
    parts(id)
    heads.push(id)
  }
  heads.sort()
  const sequence = heads.at(-1)?.slice(0, 10)
  return heads.filter(id => id.slice(0, 10) === sequence)
}

const blobName = (id: string) => 'todou-snapshot-v1-' + parts(id).digest + '.json'
export async function loadSharedRestore(files: RemoteFiles, id: string) {
  const content = await files.read(blobName(id))
  if (!content || await sha256Hex(content) !== parts(id).digest) throw new Error(t('共享快照缺失或校验失败，本机数据已保留。'))
  return parseLocalDataExport(content)
}

export async function prepareSharedRestore(files: RemoteFiles, data: LocalDataExport) {
  const previous = restoreHeads(await files.list())
  const sequence = previous.length ? parts(previous[0]!).sequence + 1 : 1
  if (sequence > 9999999999) throw new Error(t('共享恢复代次已达上限。'))
  const content = JSON.stringify(data)
  parseLocalDataExport(content)
  const id = String(sequence).padStart(10, '0') + '-' + await sha256Hex(content)
  return { previous, content, id }
}

export async function publishSharedRestore(files: RemoteFiles, candidate: RestoreCandidate, beforeAnnounce?: () => void) {
  const { id, previous, content } = candidate
  if (await sha256Hex(content) !== parts(id).digest) throw new Error(t('发布快照校验失败，请重新预览。'))
  const current = async () => {
    const heads = restoreHeads(await files.list())
    if (heads.includes(id)) return true
    if (JSON.stringify(heads) !== JSON.stringify(previous)) throw new Error(t('共享恢复版本已改变，请重新预览。'))
    return false
  }
  const alreadyPublished = await current()
  if (!alreadyPublished) {
    await files.write(blobName(id), content)
    await loadSharedRestore(files, id)
    if (!await current()) {
      // 读回并核对快照内容后才公布代次。元信息在文件名内，中断的标记正文不会成为破损快照。
      beforeAnnounce?.()
      await files.write(markerPrefix + id + '.json', JSON.stringify({ version: 1, id }))
    }
  } else {
    // 上次发布可能已落盘，只是确认响应丢失。重试时仍检查远端快照。
    if (await files.read(blobName(id)) !== content) {
      await files.write(blobName(id), content)
      await loadSharedRestore(files, id)
    }
  }
  const heads = restoreHeads(await files.list())
  if (!heads.includes(id)) throw new Error(t('网盘尚未确认共享恢复版本，请重试。'))
  return heads
}

export async function directoryForRestore(files: RemoteFiles, accepted?: string) {
  const names = await files.list()
  const heads = restoreHeads(names)
  if (heads.length > 1) throw new Error(t('有多个同时发布的恢复版本。请在网盘同步设置中预览并选择。'))
  if (heads[0] !== accepted) {
    if (!heads.length) throw new Error(t('网盘缺少本机已接受的恢复版本，请检查目录。'))
    throw new Error(t('有待确认的共享恢复版本，请在网盘同步设置中预览。'))
  }
  if (!accepted) return { ...files, list: async () => names }
  parts(accepted)
  const prefix = 'r' + accepted + '-'
  return {
    list: async () => names.filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)),
    read: (name: string) => files.read(prefix + name),
    write: (name: string, data: string) => files.write(prefix + name, data),
    remove: (name: string) => files.remove(prefix + name),
  }
}
