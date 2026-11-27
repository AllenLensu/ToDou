import { t } from '../i18n'
import { exchangeChangeBatches, prepareChangeBatches } from './changeExchange'
import type { FieldChange } from './fieldMerge'
import type { RemoteFiles } from './providers/files'
import { isTagVisibility } from './tagVisibility'
import { isPurgeKey } from './taskPurge'

// 1.0 只读取 todou-changes-*。标签删除状态单独打包，旧端仍可交换它支持的全部字段。
const extensions = [
  { prefix: 'tag-state-', accepts: isTagVisibility, error: '标签状态文件包含不支持的内容。' },
  { prefix: 'task-purge-', accepts: isPurgeKey, error: '同步文件包含不支持的字段或字段值。' },
]

export async function exchangeTaskFields(files: RemoteFiles, seen: string[], changes: FieldChange[]) {
  const names = await files.list()
  const ordinary = await exchangeChangeBatches({ ...files, list: async () => names },
    new Set(seen.filter(name => !extensions.some(ext => name.startsWith(ext.prefix)))),
    await prepareChangeBatches(changes.filter(field => field.collection !== 'settings' || !extensions.some(ext => ext.accepts(field.id)))))
  for (const { prefix, accepts, error } of extensions) {
    const matches = (field: FieldChange) => field.collection === 'settings' && accepts(field.id)
    const outgoing = changes.filter(matches)
    const extNames = names.filter(name => name.startsWith(prefix))
    const extSeen = seen.filter(name => name.startsWith(prefix))
    if (!outgoing.length && !extNames.length && !extSeen.length) continue
    const extended = await exchangeChangeBatches({
      list: async () => extNames.map(name => name.slice(prefix.length)),
      read: name => files.read(prefix + name),
      write: (name, data) => files.write(prefix + name, data),
      remove: name => files.remove(prefix + name),
    }, new Set(extSeen.map(name => name.slice(prefix.length))), await prepareChangeBatches(outgoing))
    for (const batch of extended.incoming) {
      if (!batch.changes.every(matches)) throw new Error(t(error))
      ordinary.incoming.push({ name: prefix + batch.name, changes: batch.changes })
    }
    ordinary.acknowledged.push(...extended.acknowledged.map(name => prefix + name))
  }
  return ordinary
}
