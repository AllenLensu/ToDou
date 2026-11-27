import { t } from '../i18n'
import { getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue'
import {
  beginOneDrive, connectionStorageKey, connectWebDav, disconnectProvider, finishOneDriveRedirect,
  probeConnection, readConnection, type OneDriveAccountType,
} from '../sync/providers'

// 连接状态放在模块级，离开设置页不会丢失在途操作和反馈；读写探测不代表完整同步验收。
// 这里只暴露只读连接摘要与显式操作，凭据由 provider 留在本机；授权成功不等于启用当前任务库的同步。
const connected = shallowRef<ReturnType<typeof readConnection>>(null)
const unreadable = shallowRef(false)
const busy = shallowRef(false)
const message = shallowRef('')
const failed = shallowRef(false)
const returnedToOneDrive = shallowRef(false)
const oneDriveClientId = import.meta.env?.VITE_ONEDRIVE_CLIENT_ID?.trim() || 'f5997e89-9ba3-493e-b76d-566527395124'
let storageSubscribers = 0

function reportError(error: unknown) {
  failed.value = true
  message.value = error instanceof Error ? error.message : t('无法验证连接，请检查网络和账号授权后重试。')
}

export function refreshDeviceConnection() {
  try {
    connected.value = readConnection()
    unreadable.value = false
  } catch (error) {
    connected.value = null
    unreadable.value = true
    reportError(error)
  }
}

function onConnectionStorage(event: StorageEvent) {
  if (!event.key || event.key === connectionStorageKey) refreshDeviceConnection()
}

function subscribeConnectionStorage() {
  if (!getCurrentScope() || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  if (storageSubscribers++ === 0) window.addEventListener('storage', onConnectionStorage)
  onScopeDispose(() => {
    if (--storageSubscribers === 0 && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', onConnectionStorage)
    }
  })
}

export async function initializeDeviceConnection(returnedFromLogin: boolean, launchUrl?: string) {
  // 启动时可先处理授权回调而不打开任务库；回调落在另一窗口时也只更新本机连接。
  returnedToOneDrive.value = returnedFromLogin
  refreshDeviceConnection()
  if (returnedFromLogin) {
    failed.value = false
    busy.value = true
    message.value = ''
  }
  try {
    if (await finishOneDriveRedirect(launchUrl)) message.value = t('OneDrive 登录与目录读写已通过。')
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
    refreshDeviceConnection()
  }
}

async function run(action: () => Promise<void> | void, success: string) {
  if (busy.value) return false
  busy.value = true
  message.value = ''
  failed.value = false
  try {
    await action()
    refreshDeviceConnection()
    if (unreadable.value) return false
    message.value = success
    return true
  } catch (error) {
    reportError(error)
    return false
  } finally {
    busy.value = false
  }
}

const readonlyConnected = readonly(connected)
const readonlyUnreadable = readonly(unreadable)
const readonlyBusy = readonly(busy)
const readonlyMessage = readonly(message)
const readonlyFailed = readonly(failed)
const readonlyReturnedToOneDrive = readonly(returnedToOneDrive)

export function useDeviceConnection() {
  subscribeConnectionStorage()
  return {
    connected: readonlyConnected,
    unreadable: readonlyUnreadable,
    busy: readonlyBusy,
    message: readonlyMessage,
    failed: readonlyFailed,
    returnedToOneDrive: readonlyReturnedToOneDrive,
    connectDav: (url: string, username: string, password: string) =>
      run(() => connectWebDav({ url, username, password }), t('WebDAV 目录读写已通过。')),
    connectDrive: (accountType: OneDriveAccountType) =>
      run(() => beginOneDrive(oneDriveClientId, accountType), t('正在前往微软登录…')),
    check: () => run(probeConnection, t('目录读写已通过。')),
    disconnect: () => run(disconnectProvider, t('已清除本机网盘授权。')),
  }
}
