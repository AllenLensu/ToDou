import { t } from '../i18n'
import type { TaskStore } from '../storage/types'
import type { RemoteFiles } from './providers/files'
import { exchangeTaskFields } from './exchangeTaskFields'
import { directoryForRestore } from './sharedRestore'

/** 网络阶段不占用存储写队列；准备和落盘分别排队，交换期间仍可本机编辑。 */
export async function synchronizeDevice(
  store: TaskStore, scope: string, remote: RemoteFiles,
  isCurrent: () => boolean,
  commit: (apply: () => Promise<void>, hasIncoming: boolean) => Promise<void>,
) {
  function checkConnection() {
    if (!isCurrent()) throw new Error(t('本次同步已停止，本地改动会在下次同步时核对。'))
  }
  const guarded: RemoteFiles = {
    list() { checkConnection(); return remote.list() },
    read(name) { checkConnection(); return remote.read(name) },
    write(name, data) { checkConnection(); return remote.write(name, data) },
    remove(name) { checkConnection(); return remote.remove(name) },
  }
  async function exchange() {
    checkConnection()
    // 存储先固定在途字段版本及恢复代次；重试沿用原批次，不夹带之后的新编辑。
    const { changes, seen, generation, restoreId } = await store.prepareFieldSync(scope)
    const files = await directoryForRestore(guarded, restoreId)
    const { incoming, acknowledged } = await exchangeTaskFields(files, seen, changes)
    checkConnection()
    await commit(async () => {
      checkConnection()
      // 传回实际发送的 changes，而非此刻最新值；只清除已确认版本，保留在途新改动。
      await store.finishFieldSync(scope, incoming, changes, acknowledged, generation)
    }, incoming.length > 0)
  }
  await exchange()
  // 原在途批次确认后至多再交换一次，带上积累的新改动；不循环追赶持续编辑。
  if (isCurrent() && (await store.fieldSyncStatus(scope)).pending > 0) await exchange()
}
