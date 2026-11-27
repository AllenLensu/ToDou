import { t } from '../../i18n'
import type { HttpReply } from './http'

// 只提取已知服务码、受限请求 ID 和特定许可提示；不回显可能含隐私或签名地址的任意错误字段。
const knownCodes = new Set([
  'accessDenied', 'activityLimitReached', 'authenticationFailure', 'badArgument',
  'badRequest', 'errorAccessDenied', 'errorItemNotFound', 'forbidden',
  'generalException', 'insufficientPrivileges', 'invalidAuthenticationToken',
  'invalidParameter', 'invalidParameterFormat', 'invalidPath', 'invalidQuery', 'invalidRange', 'invalidRequest',
  'invalidResourceId', 'itemNotFound', 'malformedEntityTag', 'nameAlreadyExists',
  'notAllowed', 'notFound', 'notSupported', 'quotaLimitReached',
  'resourceModified', 'resourceNotFound', 'resyncRequired', 'serviceNotAvailable',
  'serviceUnavailable', 'throttledRequest', 'tooManyRequests', 'unauthenticated',
  'unknownError',
].map(code => code.toLowerCase()))

function graphErrorDetails(body: string) {
  let payload
  try { payload = JSON.parse(body) } catch { return [] }
  const codes = new Set<string>()
  let requestId = ''
  let missingLicense = false
  let error = payload?.error
  // 只沿内层错误链读取有限层数；服务 message 仅识别许可短语，不直接展示原文。
  for (let depth = 0; depth < 8 && error && typeof error === 'object'; depth++) {
    if (typeof error.code === 'string' && knownCodes.has(error.code.toLowerCase())) codes.add(error.code)
    if (typeof error.message === 'string' && /tenant does not have a SPO license/i.test(error.message)) {
      missingLicense = true
    }
    const id = error['request-id']
    if (typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) requestId = id
    error = error.innerError ?? error.innererror
  }
  const details = [...codes]
  if (missingLicense) details.push(t('微软报告此组织缺少 SharePoint Online 许可'))
  if (requestId) details.push(t('请求 ID {0}', requestId))
  return details
}

const operationLabels = {
  get openAppFolder() { return t('打开应用目录') },
  get listFolder() { return t('列出目录') },
  get readMetadata() { return t('读取文件信息') },
  get download() { return t('下载文件') },
  get write() { return t('写入文件') },
  get remove() { return t('删除文件') },
}

export function checkOneDriveStatus(operation: keyof typeof operationLabels, reply: HttpReply, expected: number[], graphResponse = true) {
  if (expected.includes(reply.status)) return
  const details = ['HTTP ' + reply.status]
  // 签名下载地址返回的正文不是 Graph 错误；调用方传 false，只保留 HTTP 状态。
  if (graphResponse) details.push(...graphErrorDetails(reply.body))
  let hint = ''
  if (reply.status === 401 || reply.status === 403) hint = t('请确认账号已授权访问 ToDou 的应用目录。')
  else if (reply.status === 429) hint = t('请稍后重试。')
  else if (reply.status === 400 && operation === 'openAppFolder') hint = t('请用同一账号打开 OneDrive 网页，确认能进入「我的文件」。')
  throw new Error(t('OneDrive {0}失败（{1}）。{2}', operationLabels[operation], details.join(' · '), hint).trimEnd())
}
