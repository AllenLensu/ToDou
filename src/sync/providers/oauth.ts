import { newId } from '../../storage/transform'
import { t } from '../../i18n'
// OneDrive 授权码 + PKCE；调用方保管本机授权尝试，此处校验回调并兑换／刷新令牌。
import { expectStatus, readObject, request } from './http'

export type OneDriveAccountType = 'personal' | 'organization'
export type LoginAttempt = {
  clientId: string; redirect: string; verifier: string; state: string; createdAt: number; accountType?: OneDriveAccountType
}
export type Tokens = { access: string; refresh: string; expiresAt: number }
// 只申请应用目录读写及离线续期，不申请整个网盘的读写权限。
const scopes = 'offline_access Files.ReadWrite.AppFolder'

function authorityBase(accountType?: OneDriveAccountType) {
  switch (accountType) {
    case 'personal': return 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
    case 'organization': return 'https://login.microsoftonline.com/organizations/oauth2/v2.0'
    // 兼容未保存账号类型的旧连接与在途回调，继续使用其原有 common 授权入口。
    case undefined: return 'https://login.microsoftonline.com/common/oauth2/v2.0'
    default: throw new Error(t('OneDrive 账号类型无效，请重新选择个人或组织账号。'))
  }
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/, '')

export async function makeLogin(clientId: string, redirect: string, state: string = newId(), accountType?: OneDriveAccountType) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) throw new Error(t('此版本的 OneDrive 应用配置无效，请联系应用提供方。'))
  if (!crypto.subtle) throw new Error(t('连接 OneDrive 需要通过 HTTPS 或 localhost 打开 ToDou。'))
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const pending: LoginAttempt = { clientId, redirect, verifier, state, createdAt: Date.now(), accountType }
  const url = new URL(authorityBase(accountType) + '/authorize')
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', response_mode: 'fragment',
    scope: scopes, code_challenge_method: 'S256', code_challenge: base64url(new Uint8Array(hash)),
    state: pending.state, prompt: 'select_account',
  }).toString()
  return { url: url.href, pending }
}

export function validateCallback(value: string, pending: LoginAttempt) {
  // 同时绑定回调来源／路径、state 和十分钟时限；设备时钟早于发起时间也拒绝。
  const callback = new URL(value)
  const redirect = new URL(pending.redirect)
  const params = callback.hash ? new URLSearchParams(callback.hash.slice(1)) : callback.searchParams
  if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || params.get('state') !== pending.state ||
    Date.now() - pending.createdAt > 10 * 60_000 || Date.now() < pending.createdAt) {
    throw new Error(t('登录回调与本次授权不匹配或已过期，请重新连接。'))
  }
  if (params.has('error')) throw new Error(t('Microsoft 未授权本次连接，请检查帐号和应用注册后重试。'))
  const code = params.get('code')
  if (!code) throw new Error(t('未收到登录授权码，请重新连接。'))
  return code
}

async function fetchTokens(parameters: Record<string,string>, accountType?: OneDriveAccountType, previousRefresh?: string): Promise<Tokens> {
  const body = new URLSearchParams({ ...parameters, scope: scopes }).toString()
  const reply = await request('token','POST', authorityBase(accountType) + '/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, body)
  if (reply.status === 400 || reply.status === 401) throw new Error(t('OneDrive 授权无效或已过期，请核对应用注册与回调地址后重新连接。'))
  expectStatus(reply, 200)
  const data = readObject(reply.body)
  // 刷新响应未轮换 refresh_token 时沿用原值；首次兑换没有旧值可回退。
  const refresh = data.refresh_token ?? previousRefresh
  if (typeof data.access_token !== 'string' || !data.access_token || typeof refresh !== 'string' || !refresh || !(Number(data.expires_in) > 0)) {
    throw new Error(t('OneDrive 没有返回可续期的授权，请重新连接。'))
  }
  return { access: data.access_token, refresh, expiresAt: Date.now() + Number(data.expires_in) * 1000 }
}

export const exchangeCode = (pending: LoginAttempt, code: string) => fetchTokens({
  client_id: pending.clientId, grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: pending.redirect,
}, pending.accountType)
export const renewTokens = (clientId: string, refresh: string, accountType?: OneDriveAccountType) => fetchTokens({
  client_id: clientId, grant_type:'refresh_token', refresh_token: refresh,
}, accountType, refresh)
