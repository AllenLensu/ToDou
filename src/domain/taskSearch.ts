import { t } from '../i18n'
// 纯内存搜索与命中线索；NFKC 和大小写统一只用于匹配，不改动存储的原文。
import type { Category, ChecklistItem, Tag, Task } from '../storage/types'

export type SearchSource = { tasks: readonly Task[]; checklistItems: readonly ChecklistItem[]; categories: readonly Category[]; tags: readonly Tag[] }
type SearchField = { label: string; text: string; normalized: string }
export type SearchDocument = { fields: SearchField[]; text: string }
export type SearchPart = { text: string; match: boolean }
export type SearchEvidence = { label: string; parts: SearchPart[] }
const normalize = (text: string) => text.normalize('NFKC').toLowerCase()

export function searchTokens(query: string): string[] {
  return [...new Set(normalize(query).split(/\s+/u).filter(Boolean))]
}

/** 随已保存数据的版本建立索引，查询本身不读写 SQLite。 */
export function buildSearchIndex(source: SearchSource): Map<string, SearchDocument> {
  const checks = new Map<string, ChecklistItem[]>()
  for (const item of source.checklistItems) {
    if (item.deletedAt) continue
    const group = checks.get(item.taskId) ?? []
    group.push(item)
    checks.set(item.taskId, group)
  }
  const categories = new Map(source.categories.map((item) => [item.id, item.name]))
  const tags = new Map(source.tags.map((item) => [item.id, item.name]))
  const index = new Map<string, SearchDocument>()
  for (const task of source.tasks) {
    if (task.deletedAt) continue
    const fields: SearchField[] = []
    const add = (label: string, text: string | null | undefined) => {
      if (text) fields.push({ label, text, normalized: normalize(text) })
    }
    add(t('任务标题'), task.title)
    add(t('任务备注'), task.notes)
    add(t('主分类'), categories.get(task.categoryId ?? ''))
    for (const id of task.tagIds) add(t('标签'), tags.get(id))
    for (const item of checks.get(task.id) ?? []) {
      add(t('检查项「{0}」标题', item.title), item.title)
      add(t('检查项「{0}」备注', item.title), item.notes)
    }
    // 查询词不含空白；换行分隔字段，避免一个词跨字段边界拼接命中。
    index.set(task.id, { fields, text: fields.map((field) => field.normalized).join('\n') })
  }
  return index
}

/** 接收 searchTokens 产生的规范化词；所有词都须命中同一任务，但可分布在不同字段，空词组匹配全部。 */
export function searchTaskIds(index: ReadonlyMap<string, SearchDocument>, tokens: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const [id, doc] of index) if (tokens.every((token) => doc.text.includes(token))) ids.add(id)
  return ids
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 将规范化后的命中位置映回原始字素，避免兼容字符、全角和组合音标高亮错位。 */
function originalRanges(field: SearchField, tokens: readonly string[]) {
  // 兼容字符可能跨原始字素组合（ㄱ + ㅏ → 가）；先 NFKD 分解并保留原文 UTF-16 范围，再重新分字素。
  let decomposed = ''
  const sourceStarts: number[] = []
  const sourceEnds: number[] = []
  for (const part of segmenter.segment(field.text)) {
    const text = part.segment.normalize('NFKD')
    decomposed += text
    for (let i = 0; i < text.length; i++) { sourceStarts.push(part.index); sourceEnds.push(part.index + part.segment.length) }
  }
  const starts: number[] = []
  const ends: number[] = []
  // 为规范化结果的每个 UTF-16 位置记录完整原始字素范围，与 includes/indexOf 的偏移单位一致。
  for (const part of segmenter.segment(decomposed)) {
    const length = normalize(part.segment).length
    for (let i = 0; i < length; i++) { starts.push(sourceStarts[part.index]!); ends.push(sourceEnds[part.index + part.segment.length - 1]!) }
  }
  const ranges: Array<{ start: number; end: number }> = []
  for (const token of tokens) {
    // 每个词在每个字段只展示首次命中，避免长备注生成大量高亮片段。
    const at = field.normalized.indexOf(token)
    if (at >= 0) ranges.push({ start: starts[at]!, end: ends[at + token.length - 1]! })
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: typeof ranges = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** 分散的查询词各自保留上下文；返回文本片段供 Vue 转义显示，不生成 HTML。 */
export function searchEvidence(doc: SearchDocument, tokens: readonly string[]): SearchEvidence[] {
  if (!tokens.length) return []
  const result: SearchEvidence[] = []
  const uncovered = new Set(tokens)
  for (const field of doc.fields) {
    if (!tokens.some((token) => field.normalized.includes(token))) continue
    // 按字段顺序补足各查询词的线索，裁剪窗口重叠时合并上下文。
    const ranges = originalRanges(field, tokens)
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]!
      const start = Math.max(0, range.start - 18)
      let end = Math.min(field.text.length, range.end + 24)
      const hits = [range]
      while (ranges[i + 1] && ranges[i + 1]!.start <= end) {
        hits.push(ranges[++i]!)
        end = Math.min(field.text.length, ranges[i]!.end + 24)
      }
      const parts: SearchPart[] = []
      let cursor = start
      if (start > 0) parts.push({ text: '…', match: false })
      for (const hit of hits) {
        if (hit.start > cursor) parts.push({ text: field.text.slice(cursor, hit.start), match: false })
        parts.push({ text: field.text.slice(hit.start, hit.end), match: true })
        cursor = hit.end
      }
      if (cursor < end) parts.push({ text: field.text.slice(cursor, end), match: false })
      if (end < field.text.length) parts.push({ text: '…', match: false })
      result.push({ label: field.label, parts })
    }
    for (const token of tokens) if (field.normalized.includes(token)) uncovered.delete(token)
    // 至少三个片段且所有词都有线索后才停止；三个是停止门槛，不是结果数硬上限。
    if (result.length >= 3 && !uncovered.size) break
  }
  return result
}
