import { t } from '../i18n'
// 授权返回后的等待阶段。加载只覆盖这段等待，结束时交还给连接层已有的成功或错误文案。
export const authorizationReturnLoadingText = '正在验证连接…'
export const authorizationReturnSegmentCount = 4

export function authorizationReturnPhase(returned: boolean, busy: boolean, message: string): 'loading' | 'result' | 'idle' {
  if (!returned || (!busy && !message)) return 'idle'
  return busy ? 'loading' : 'result'
}

export function createAuthorizationReturnLoading(doc: Document) {
  const status = doc.createElement('p')
  status.className = 'auth-return-loading inline-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-busy', 'true')
  const segments = doc.createElement('span')
  segments.className = 'auth-return-segments'
  segments.setAttribute('aria-hidden', 'true')
  for (let index = 0; index < authorizationReturnSegmentCount; index += 1) segments.append(doc.createElement('span'))
  status.append(segments, doc.createTextNode(t(authorizationReturnLoadingText)))
  return status
}
