import { t } from '../../i18n'
export const graphBase = 'https://graph.microsoft.com/v1.0'
export type HttpReply = { status: number; body: string }
type Scope = 'token' | 'graph' | 'download' | 'webdav'

// JSON 解析异常可能夹带令牌或签名下载地址，因此只返回固定诊断，不回显响应正文。
export function readObject(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch { /* 不透传解析器的原始异常。 */ }
  throw new Error(t('网盘返回了无法识别的响应。'))
}

export async function request(scope: Scope, method: string, url: string, headers: Record<string,string> = {}, body?: string): Promise<HttpReply> {
  try {
    // 不附带浏览器凭据、不跟随重定向，也不发送来源页地址；显式授权头仍由调用方提供。
    const response = await fetch(url, {
      method, headers, body, mode: 'cors', credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(90_000),
    })
    return { status: response.status, body: await response.text() }
  } catch {
    // fetch 异常可能带请求地址；只给固定提示，避免令牌或签名 URL 进入应用诊断。
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(t('设备已断网，请恢复联网后重试。'))
    if (scope === 'webdav') throw new Error(t('浏览器无法直连 WebDAV。请检查网络、目录地址，以及服务端是否允许此页面来源的跨域请求（CORS）。'))
    throw new Error(t('无法连接网盘。请检查网络、服务地址和证书后重试。'))
  }
}

export function expectStatus(reply: HttpReply, ...statuses: number[]) {
  // 通用 HTTP 失败只展示状态，不拼接可能含凭据或私密路径的响应正文。
  if (statuses.includes(reply.status)) return
  if (reply.status === 401 || reply.status === 403) throw new Error(t('网盘授权已失效，或没有此目录的读写权限。请重新连接。'))
  if (reply.status === 429) throw new Error(t('网盘请求过于频繁，请稍后重试。'))
  throw new Error(t('网盘操作失败（HTTP {0}）。请检查目录与服务状态。', reply.status))
}
