/** Translate an app-owned status saved in an earlier locale, including errors returned by a native process. */
type Catalog = Readonly<Record<string, string | readonly string[]>>
type FeedbackPattern = { parts: string[]; slots: number[]; output: string }

function argumentsFor(text: string, pattern: FeedbackPattern): string[] | null {
  const { parts, slots } = pattern
  if (!text.startsWith(parts[0]) || !text.endsWith(parts[parts.length - 1])) return null
  const values: string[] = []
  let offset = parts[0].length
  for (let i = 0; i < slots.length; i++) {
    const next = parts[i + 1]
    const end = i === slots.length - 1 ? text.length - next.length : text.indexOf(next, offset)
    if (end < offset) return null
    values[slots[i]] = text.slice(offset, end)
    offset = end + next.length
  }
  return values
}

// Only persisted feedback or native diagnostics need to be read back from a formatted string.
// Ordinary UI formats (counts, date offsets, labels) must never match arbitrary text in an error.
const diagnosticFormats = new Set([
  '导入数据不完整或无效：{0}', '{0} 包含重复标识 {1}', '{0} 引用不存在', '{0}.parentTaskId 自引用',
  '{0}.tagIds 重复', '{0} 名称重复', '{0} 自引用', '{0} 关联重复', '{0}.snapshot.id 不匹配',
  '本地数据库升级失败：{0} 请重新加载后重试。', '本地数据库初始化失败：{0}', '本地数据库版本 {0} 高于当前应用支持的版本 {1}',
  'OPFS 数据库读取失败（SQLite {0}）', '未知父任务完成策略: {0}', '未知主题: {0}', '未知任务状态: {0}',
  '未知任务优先级: {0}', '未知检查项重复模式: {0}', '本地数据库升级失败：{0} 请重新打开 ToDou 后重试。',
  '本地数据库读取失败（SQLite {0}）', '请求 ID {0}', '网盘操作失败（HTTP {0}）。请检查目录与服务状态。',
  '无法开始替换本地数据库：{0}', '替换本地数据库失败：{0}',
])

function feedbackIndex(messages: Catalog, english: boolean, native: Catalog) {
  const exact = new Map<string, string>()
  const patterns: FeedbackPattern[] = []
  for (const [key, entry] of Object.entries(messages)) {
    const [zh, en] = typeof entry === 'string' ? [key, entry] : entry
    const [source, output] = english ? [zh, en] : [en, zh]
    if (source === output) continue
    const slots = [...source.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]))
    if (!slots.length) { exact.set(source, output); continue }
    if (!key.startsWith('[') && !diagnosticFormats.has(key) && !Object.hasOwn(native, key)) continue
    const parts = source.split(/\{\d+\}/g)
    // Adjacent slots cannot be separated unambiguously. Require a recognisable message prefix or suffix.
    if (!parts.slice(1, -1).every(Boolean) || !(parts[0].trim() || parts[parts.length - 1].trim())) continue
    patterns.push({ parts, slots, output })
  }
  patterns.sort((a, b) => b.parts.join('').length - a.parts.join('').length)
  return { exact, patterns }
}

export function createFeedbackTranslator(messages: Catalog, locale: () => string, native: Catalog = {}) {
  const indices = new Map<string, ReturnType<typeof feedbackIndex>>()
  return (text: string | null | undefined): string => {
    if (!text) return ''
    const language = locale()
    let index = indices.get(language)
    if (!index) { index = feedbackIndex(messages, language === 'en', native); indices.set(language, index) }
    const exact = index.exact.get(text)
    if (exact !== undefined) return exact
    for (const pattern of index.patterns) {
      const values = argumentsFor(text, pattern)
      if (values) return pattern.output.replace(/\{(\d+)\}/g, (match, slot: string) => values[Number(slot)] ?? match)
    }
    return text
  }
}
