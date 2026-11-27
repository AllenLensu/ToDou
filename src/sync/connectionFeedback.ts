import { feedbackText, t } from '../i18n'

// Graph 诊断只包含受限服务码、请求 ID 和应用提示。切换语言时单独转换这些已知展示字段。
const chineseGraphError = /^OneDrive (.+?)失败（([^）]+)）。(.*)$/u
const englishGraphError = /^OneDrive: (.+?) failed \(([^)]+)\)\.\s*(.*)$/u

export function syncFeedbackText(message: string): string {
  const cleanup = message.split(/ 临时文件清理也失败。| The temporary file could not be removed either\. /u)
  if (cleanup.length === 2) {
    return t('{0} 临时文件清理也失败。{1}', syncFeedbackText(cleanup[0]!), syncFeedbackText(cleanup[1]!))
  }
  const match = chineseGraphError.exec(message) ?? englishGraphError.exec(message)
  if (!match) return feedbackText(message)
  const [, operation, details, hint] = match
  return t('OneDrive {0}失败（{1}）。{2}', feedbackText(operation!),
    details!.split(' · ').map(detail => feedbackText(detail)).join(' · '), feedbackText(hint)).trimEnd()
}
