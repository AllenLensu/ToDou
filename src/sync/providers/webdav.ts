import { t } from '../../i18n'
// WebDAV 只操作规范化目录及合法单层文件名；连接时探测并按需创建目录，不递归创建父目录。
import { expectStatus, request } from './http'
import { fileName, validName, type RemoteFiles } from './files'

export type WebDav = { kind: 'webdav'; url: string; username: string; password: string }
export function normalizeFolder(value: string) {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error(t('请输入完整的 WebDAV 同步目录地址。')) }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error(t('WebDAV 目录需要 HTTPS 地址。'))
  if (url.username || url.password || url.search || url.hash) throw new Error(t('请单独填写账号和应用密码，目录地址应只包含路径。'))
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

function client(config: WebDav) {
  const bytes = new TextEncoder().encode(config.username + ':' + config.password)
  const authorization = 'Basic ' + btoa(Array.from(bytes, code => String.fromCharCode(code)).join(''))
  const folder = normalizeFolder(config.url)
  return (method: string, name = '', body?: string, headers: Record<string,string> = {}) =>
    request('webdav', method, folder + (name ? fileName(name) : ''), { Authorization: authorization, ...headers }, body)
}

const properties = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
const propHeaders = (depth: string) => ({ Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' })

function listNames(xml: string, folder: URL) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (root.localName !== 'multistatus' || root.namespaceURI !== 'DAV:') throw new Error(t('目录返回的内容不是有效的 WebDAV 列表。'))
  const names = []
  const rows = Array.from(root.getElementsByTagNameNS('DAV:', 'response'))
  // 坚果云部分账号可能在 750 条 response 截断（含目录自身）；达到阈值就拒绝，不能确认已读全。
  // 这只是已知服务的截断检测，不是通用 WebDAV 分页或所有服务完整性的保证。
  if (folder.hostname === 'dav.jianguoyun.com' && rows.length >= 750) throw new Error(t('坚果云目录可能已达到单页上限，无法确认已读取完整目录。'))
  for (const row of rows) {
    const href = row.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent
    if (!href || row.getElementsByTagNameNS('DAV:', 'collection').length) continue
    let name: string
    try {
      const url = new URL(href, folder)
      if (url.origin !== folder.origin || !url.pathname.startsWith(folder.pathname)) continue
      name = decodeURIComponent(url.pathname.slice(folder.pathname.length))
    } catch {
      // An invalid URL or percent-encoded name cannot identify a supported file.
      continue
    }
    if (validName(name)) names.push(name)
  }
  return names
}

export async function ensureWebDavFolder(config: WebDav) {
  const call = client(config)
  const reply = await call('PROPFIND', '', properties, propHeaders('0'))
  if (reply.status !== 404) return expectStatus(reply, 207)
  const created = await call('MKCOL')
  if (created.status === 405) {
    // 首次探测后可能已有另一设备建好目录；405 仍需重新 PROPFIND 确认，不能直接视为创建成功。
    return expectStatus(await call('PROPFIND', '', properties, propHeaders('0')), 207)
  }
  expectStatus(created, 201)
}

export function webDavFiles(config: WebDav): RemoteFiles {
  const call = client(config)
  return {
    async list() {
      // 交换层需要完整的单层目录；这里用 Depth:1 一次读取，再筛掉目录、越界地址和非法文件名。
      const reply = await call('PROPFIND', '', properties, propHeaders('1'))
      expectStatus(reply, 207)
      return listNames(reply.body, new URL(config.url))
    },
    async read(name) {
      const reply = await call('GET', fileName(name))
      if (reply.status === 404) return null
      expectStatus(reply, 200)
      return reply.body
    },
    async write(name, content) {
      expectStatus(await call('PUT', fileName(name), content, { 'Content-Type': 'application/json' }), 200, 201, 204)
    },
    async remove(name) { expectStatus(await call('DELETE', fileName(name)), 200, 204, 404) },
  }
}
