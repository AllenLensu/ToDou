import { t } from '../../i18n'
// 在 OneDrive 应用目录内读写文本文件；Graph 请求遇到 401 时仅强制刷新令牌并重试一次。
import { graphBase, readObject, request } from './http'
import { fileName, validName, type RemoteFiles } from './files'
import { checkOneDriveStatus } from './graphErrors'

export async function graphFiles(token: (force?: boolean) => Promise<string>): Promise<RemoteFiles & { folderIdentity: string | null }> {
  async function call(method: string, path: string, body?: string) {
    if (!path.startsWith(graphBase + '/')) throw new Error(t('OneDrive 分页地址无效。'))
    const headers: Record<string,string> = { Authorization: 'Bearer ' + await token() }
    if (body !== undefined) headers['Content-Type'] = 'text/plain'
    let reply = await request('graph', method, path, headers, body)
    if (reply.status === 401) {
      headers.Authorization = 'Bearer ' + await token(true)
      reply = await request('graph', method, path, headers, body)
    }
    return reply
  }
  const folder = graphBase + '/me/drive/special/approot'
  const root = await call('GET', folder)
  checkOneDriveStatus('openAppFolder', root, [200])
  const item = readObject(root.body)
  if (!item.folder || typeof item.id !== 'string' || !item.id) throw new Error(t('无法取得 ToDou 的 OneDrive 应用目录。'))
  const reference = item.parentReference as { driveId?: unknown } | undefined
  const permittedListings = new Set([folder + '/children', graphBase + '/me/drive/items/' + encodeURIComponent(item.id) + '/children'])
  if (typeof reference?.driveId === 'string' && reference.driveId) {
    permittedListings.add(graphBase + '/drives/' + encodeURIComponent(reference.driveId) + '/items/' + encodeURIComponent(item.id) + '/children')
  }
  const file = (name: string) => folder + ':/' + fileName(name)
  return {
    folderIdentity: typeof reference?.driveId === 'string' && reference.driveId
      ? JSON.stringify([reference.driveId, item.id]) : null,
    async list() {
      const result: string[] = []
      const visited = new Set<string>()
      let url = folder + '/children?$select=name,file'
      // 沿 nextLink 读完才交付列表；重复页或越界地址报错，不能把已收集的部分结果交给交换层。
      while (url) {
        if (visited.has(url)) throw new Error(t('OneDrive 重复返回同一页，未取得完整列表。'))
        visited.add(url)
        if (!URL.canParse(url)) throw new Error(t('OneDrive 分页地址无效。'))
        const pageUrl = new URL(url)
        // 个人盘条目 ID 可含「!」，续页可能将其转义；统一编码后只允许当前应用目录的 children 路径。
        const canonical = pageUrl.origin + pageUrl.pathname.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/')
        if (pageUrl.username || pageUrl.password || pageUrl.hash || !permittedListings.has(canonical)) throw new Error(t('OneDrive 分页地址超出当前应用目录。'))
        const reply = await call('GET', url)
        checkOneDriveStatus('listFolder', reply, [200])
        const page = readObject(reply.body)
        if (!Array.isArray(page.value)) throw new Error(t('OneDrive 返回了无效的目录列表。'))
        for (const entry of page.value) if (entry.file && typeof entry.name === 'string' && validName(entry.name)) result.push(entry.name)
        const next = page['@odata.nextLink']
        if (next != null && typeof next !== 'string') throw new Error(t('OneDrive 分页地址无效。'))
        url = next ?? ''
      }
      return result
    },
    async read(name) {
      const metadata = await call('GET', file(name) + '?select=id,@microsoft.graph.downloadUrl')
      if (metadata.status === 404) return null
      checkOneDriveStatus('readMetadata', metadata, [200])
      const link = readObject(metadata.body)['@microsoft.graph.downloadUrl']
      if (typeof link !== 'string' || !URL.canParse(link)) throw new Error(t('OneDrive 下载地址无效。'))
      const url = new URL(link)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(t('OneDrive 下载地址无效。'))
      // HTTPS 签名下载 URL 自带短期授权，可能指向非 Graph 主机；不能附加 Graph 令牌。
      const contents = await request('download', 'GET', url.href)
      checkOneDriveStatus('download', contents, [200], false)
      return contents.body
    },
    async write(name, content) {
      checkOneDriveStatus('write', await call('PUT', file(name) + ':/content', content), [200, 201])
    },
    async remove(name) { checkOneDriveStatus('remove', await call('DELETE', file(name)), [204, 404]) },
  }
}
