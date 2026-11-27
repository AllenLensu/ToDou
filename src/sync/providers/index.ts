import { sha256Hex } from '../../domain/contentDigest'
import { newId } from '../../storage/transform'
import { t } from '../../i18n'
import { probeFiles, type RemoteFiles } from './files'
import { graphFiles } from './onedrive'
import { exchangeCode, makeLogin, renewTokens, validateCallback, type LoginAttempt, type OneDriveAccountType, type Tokens } from './oauth'
import { ensureWebDavFolder, normalizeFolder, webDavFiles, type WebDav } from './webdav'

export type { RemoteFiles } from './files'
export type { OneDriveAccountType } from './oauth'
type OneDrive = { kind: 'onedrive'; id: string; clientId: string; tokens: Tokens; accountType?: OneDriveAccountType; syncFolderId?: string }
type Config = WebDav | OneDrive
// 凭据只保存在本机来源存储，不进入 SQLite、导出 JSON 或网盘同步文件。
export const connectionStorageKey = 'todou.sync.connection.v1'
const attemptKey = 'todou.sync.login.v1'
const intentKey = 'todou.sync.connection-choice.v1'
const folderBindingPrefix = 'todou.sync.onedrive-folder.v1.'

function current(): Config | null {
  const value = localStorage.getItem(connectionStorageKey)
  if (!value) return null
  try {
    const config = JSON.parse(value)
    if (config.kind === 'webdav' && typeof config.username === 'string' && typeof config.password === 'string' && normalizeFolder(config.url) === config.url) return config
    if (config.kind === 'onedrive' && typeof config.id === 'string' && typeof config.clientId === 'string' && typeof config.tokens?.refresh === 'string' &&
      (config.accountType === undefined || config.accountType === 'personal' || config.accountType === 'organization')) return config
  } catch { /* 使用固定提示，避免解析异常回显本机凭据。 */ }
  throw new Error(t('本机保存的网盘连接无法读取，请断开后重新连接。'))
}

const save = (config: Config) => localStorage.setItem(connectionStorageKey, JSON.stringify(config))

// 在来源锁内更新连接选择，避免多个窗口覆盖彼此的授权。
function locked<T>(operation: () => T): Promise<T> {
  if (navigator.locks) return navigator.locks.request(intentKey, operation)
  // On HTTP, a short IndexedDB read/write transaction serializes these
  // synchronous localStorage updates across tabs, including login callbacks.
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(intentKey, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('intent')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('intent', 'readwrite')
      let value: T
      tx.objectStore('intent').get('lock').onsuccess = () => {
        try { value = operation() } catch (error) { tx.abort(); reject(error) }
      }
      tx.onabort = () => { db.close(); reject(tx.error) }
      tx.oncomplete = () => { db.close(); resolve(value) }
    }
  })
}

function newIntent() {
  // 每次连接或断开都换代，并废弃旧 PKCE 尝试；异步探测和授权完成后仍须核对这一代。
  const id = newId()
  localStorage.setItem(intentKey, id)
  localStorage.removeItem(attemptKey)
  return id
}

function requireIntent(id: string) {
  if (localStorage.getItem(intentKey) !== id) throw new Error(t('本机的连接选择已更改，请使用最新的连接。'))
}

function finishIntent(id: string, config: Config) {
  return locked(() => {
    requireIntent(id)
    save(config)
  })
}

export function readConnection(): {kind: 'webdav' | 'onedrive'; label: string} | null {
  const config = current()
  if (!config) return null
  return {
    kind: config.kind,
    get label() { return config.kind === 'webdav' ? config.url : t('OneDrive · ToDou 应用目录') },
  }
}

// 同步 scope 是任务库的本机绑定键，不是 OAuth 权限；不含密码或令牌。
// OneDrive 优先沿用已验证目录绑定，旧连接回退到会话 ID；WebDAV 按目录与账号散列，换密码不换绑定。
async function scopeOf(config: Config | null): Promise<string | null> {
  if (!config) return null
  if (config.kind === 'onedrive') return 'onedrive-' + (config.syncFolderId ?? config.id)
  return 'webdav-' + await sha256Hex(JSON.stringify([config.url, config.username]))
}

export const readSyncScope = () => scopeOf(current())

export async function openSyncRemote(expectedScope: string): Promise<RemoteFiles> {
  const selected = current()
  const changed = () => new Error(t('网盘连接已更改，请重新同步。'))
  if (!selected || await scopeOf(selected) !== expectedScope) throw changed()
  function checkSelection() {
    const latest = current()
    const same = selected?.kind === 'webdav' && latest?.kind === 'webdav'
      ? selected.username === latest.username && selected.url === latest.url
      : selected?.kind === 'onedrive' && latest?.kind === 'onedrive' && selected.id === latest.id
    if (!same) throw changed()
  }
  checkSelection()
  let files: RemoteFiles
  if (selected.kind === 'webdav') {
    files = webDavFiles(selected)
  } else {
    const graph = await graphFiles(force => accessToken(selected.id, force))
    if (!selected.syncFolderId && graph.folderIdentity) {
      // 为旧版仅探测过目录的连接记下映射；首次上传中断后重新授权，仍可沿用原同步 scope。
      const key = folderBindingPrefix + await sha256Hex(graph.folderIdentity)
      await locked(() => { checkSelection(); localStorage.setItem(key, selected.id) })
    }
    files = graph
  }
  // 每次操作发起前复查连接选择；不撤销已经发出的请求。
  return {
    list() { checkSelection(); return files.list() },
    read(name) { checkSelection(); return files.read(name) },
    write(name, data) { checkSelection(); return files.write(name, data) },
    remove(name) { checkSelection(); return files.remove(name) },
  }
}

export function disconnectProvider() {
  return locked(() => {
    newIntent()
    localStorage.removeItem(connectionStorageKey)
  })
}

export async function connectWebDav(input: Omit<WebDav,'kind'>) {
  if (!input.username.trim() || input.username.includes(':') || !input.password) throw new Error(t('请填写 WebDAV 账号和应用密码。'))
  const config: WebDav = { kind:'webdav', url:normalizeFolder(input.url), username:input.username.trim(), password:input.password }
  const id = await locked(newIntent)
  await ensureWebDavFolder(config)
  await probeFiles(webDavFiles(config))
  await finishIntent(id, config)
}

const refreshes = new Map<string,Promise<Tokens>>()
async function accessToken(id: string, force = false) {
  const config = current()
  if (config?.kind !== 'onedrive' || config.id !== id) throw new Error(t('本机已更换连接，请重新同步。'))
  if (!force && config.tokens.expiresAt > Date.now() + 60_000) return config.tokens.access
  let pending = refreshes.get(id)
  if (!pending) {
    // 同一会话共用在途刷新；写回时重查会话 ID，旧刷新不能覆盖新授权或已断开的连接。
    pending = renewTokens(config.clientId, config.tokens.refresh, config.accountType).then(tokens => locked(() => {
      const latest = current()
      if (latest?.kind !== 'onedrive' || latest.id !== id) throw new Error(t('本机已更换连接。'))
      save({...latest, tokens})
      return tokens
    })).finally(() => refreshes.delete(id))
    refreshes.set(id, pending)
  }
  return (await pending).access
}

export async function openRemoteFiles(): Promise<RemoteFiles> {
  const config = current()
  if (!config) throw new Error(t('请先连接网盘。'))
  if (config.kind === 'webdav') return webDavFiles(config)
  return graphFiles(force => accessToken(config.id, force))
}

export async function probeConnection() {
  await probeFiles(await openRemoteFiles())
}

export function oneDriveRedirectUri() {
  return location.origin + location.pathname
}

async function authorize(callback: string, pending: LoginAttempt) {
  // 兑换前后核对授权意图；目录探测后的最终保存也在锁内复查，避免旧结果覆盖新选择。
  requireIntent(pending.state)
  const code = validateCallback(callback, pending)
  const tokens = await exchangeCode(pending, code)
  requireIntent(pending.state)
  const config: OneDrive = {kind:'onedrive', id:newId(), clientId:pending.clientId, tokens, accountType:pending.accountType}
  const directory = await graphFiles(async () => tokens.access)
  await probeFiles(directory)
  if (directory.folderIdentity) {
    const folderHash = await sha256Hex(directory.folderIdentity)
    config.syncFolderId = localStorage.getItem(folderBindingPrefix + folderHash) ?? folderHash
  }
  await finishIntent(pending.state, config)
}

export async function beginOneDrive(clientId: string, accountType?: OneDriveAccountType) {
  const id = await locked(newIntent)
  const {url, pending} = await makeLogin(clientId.trim(), oneDriveRedirectUri(), id, accountType)
  await locked(() => {
    requireIntent(id)
    localStorage.setItem(attemptKey, JSON.stringify(pending))
  })
  location.assign(url)
}

function redirectReturn(href = location.href) {
  const url = new URL(href)
  const params = url.hash ? new URLSearchParams(url.hash.slice(1)) : url.searchParams
  return params.has('code') || params.has('error') ? {url, params} : null
}

export const hasOneDriveRedirect = (href?: string) => redirectReturn(href) !== null

export async function finishOneDriveRedirect(launchUrl?: string) {
  const callback = redirectReturn(launchUrl)
  if (!callback) {
    // 下次打开且没有回调时，清除已过期的本机 PKCE 尝试。
    if (localStorage.getItem(attemptKey)) await locked(() => {
      const value = localStorage.getItem(attemptKey)
      if (value) {
        try {
          if (Date.now() - JSON.parse(value).createdAt >= 600_000) localStorage.removeItem(attemptKey)
        } catch { localStorage.removeItem(attemptKey) }
      }
    })
    return false
  }
  const {url, params} = callback
  // 先从地址栏移除授权参数；校验仍使用保留在内存中的原回调地址。
  if (!launchUrl || launchUrl === location.href) history.replaceState(history.state, '', url.pathname)
  // PWA 回调可能落到第二个窗口：在来源锁内匹配 state 并取走尝试，只允许一个窗口进入兑换。
  // 尝试先删除再兑换，后续失败也不复用这次回调，需重新发起授权。
  const pending = await locked(() => {
    const value = localStorage.getItem(attemptKey)
    if (!value) throw new Error(t('找不到本机的登录请求，请重新连接 OneDrive。'))
    let attempt: LoginAttempt
    try { attempt = JSON.parse(value) } catch { throw new Error(t('本次登录请求无法读取，请重新连接。')) }
    if (attempt.state !== params.get('state')) throw new Error(t('登录回调与本机的授权请求不匹配。'))
    localStorage.removeItem(attemptKey)
    return attempt
  })
  await authorize(url.href, pending)
  return true
}
