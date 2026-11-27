import { sha256Hex } from '../domain/contentDigest'
import { t } from '../i18n'
// 内容寻址的不可变批次协议：先上传分片／块，最后发布可发现的清单，并校验读回内容。
import { validateFieldChange, type FieldChange } from './fieldMerge'
import type { RemoteFiles } from './providers/files'

export interface ChangeBatch {
  name: string
  changes: FieldChange[]
}

const maxFileBytes = 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const prefix = '{"version":1,"changes":['
const suffix = ']}'
const batchNamespace = 'todou-changes-'
const batchPattern = /^todou-changes-v1-([a-f0-9]{64})\.json$/
const blockPattern = /^todou-block-v1-([a-f0-9]{64})\.json$/
const partPattern = /^todou-part-v1-([a-f0-9]{64})\.txt$/

interface NamedContent { name: string; body: string }
interface EncodedBatch extends NamedContent { parts: NamedContent[] }
interface PreparedEncoding { name: string; partNames: string[]; singleBody?: string }
const prepared = new WeakMap<ChangeBatch, PreparedEncoding>()

function freezeValue(value: unknown) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeValue(child)
    Object.freeze(value)
  }
}

function encodeChange(change: FieldChange): string {
  return JSON.stringify(change, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]))
  })
}

async function encodeBatch(rows: string[], known?: PreparedEncoding): Promise<EncodedBatch> {
  let body = prefix + rows.join(',') + suffix
  let bytes = encoder.encode(body)
  const parts: NamedContent[] = []
  // 单条备注或历史也可能超限；按 UTF-8 字符边界分片，先传分片再发布引用它们的清单。
  if (bytes.length > maxFileBytes) {
    let start = 0
    while (start < bytes.length) {
      let end = Math.min(start + maxFileBytes, bytes.length)
      while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
      const chunk = bytes.subarray(start, end)
      const name = known?.partNames[parts.length] ?? 'todou-part-v1-' + await sha256Hex(chunk) + '.txt'
      parts.push({ name, body: decoder.decode(chunk) })
      start = end
    }
    body = JSON.stringify({ version: 1, parts: parts.map(part => part.name) })
    bytes = encoder.encode(body)
  }
  const name = known?.name ?? 'todou-changes-v1-' + await sha256Hex(bytes) + '.json'
  return { name, body, parts }
}

export async function prepareChangeBatches(changes: FieldChange[]): Promise<ChangeBatch[]> {
  const batches: ChangeBatch[] = []
  let rows: string[] = []
  let group: FieldChange[] = []
  let bytes = prefix.length + suffix.length
  async function finishGroup(onlyGroup: boolean) {
    const encoded = await encodeBatch(rows)
    Object.freeze(group)
    const batch = Object.freeze({ name: encoded.name, changes: group })
    // 已验证并冻结的字段可复用哈希；只缓存单个小批次正文，大批量上传时逐块序列化。
    prepared.set(batch, { name: encoded.name, partNames: encoded.parts.map(part => part.name),
      singleBody: onlyGroup && !encoded.parts.length ? encoded.body : undefined })
    batches.push(batch)
  }
  for (const input of changes) {
    const change = validateFieldChange(input)
    freezeValue(change)
    const row = encodeChange(change)
    const length = encoder.encode(row).length
    if (rows.length && bytes + 1 + length > maxFileBytes) {
      await finishGroup(false)
      rows = []
      group = []
      bytes = prefix.length + suffix.length
    }
    bytes += (rows.length ? 1 : 0) + length
    rows.push(row)
    group.push(change)
  }
  if (rows.length) await finishGroup(!batches.length)
  return batches
}

function parseEnvelope(body: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(body) } catch { throw new Error(t('网盘同步文件不是有效的 JSON。')) }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) {
    throw new Error(t('网盘同步文件版本无法识别。'))
  }
  if (Object.keys(value).length !== 2 || (!('parts' in value) && !('changes' in value) && !('blocks' in value))) {
    throw new Error(t('网盘同步文件格式无法识别。'))
  }
  return value as Record<string, unknown>
}

async function readChecked(files: RemoteFiles, name: string, expectedHash: string): Promise<string> {
  const body = await files.read(name)
  if (!body) throw new Error(t('网盘同步文件缺失或为空，请重新同步。'))
  const bytes = encoder.encode(body)
  if (bytes.length > maxFileBytes || await sha256Hex(bytes) !== expectedHash) {
    throw new Error(t('网盘同步文件完整性检查失败。'))
  }
  return body
}

async function readFields(files: RemoteFiles, envelope: Record<string, unknown>): Promise<FieldChange[]> {
  if ('parts' in envelope) {
    if ('changes' in envelope || !Array.isArray(envelope.parts) || envelope.parts.length < 2) throw new Error(t('网盘同步分片清单无效。'))
    const chunks: string[] = []
    for (const part of envelope.parts) {
      const hash = typeof part === 'string' && partPattern.exec(part)?.[1]
      if (!hash) throw new Error(t('网盘同步分片名称无效。'))
      chunks.push(await readChecked(files, part, hash))
    }
    envelope = parseEnvelope(chunks.join(''))
  }
  if ('parts' in envelope || !Array.isArray(envelope.changes) || !envelope.changes.length) throw new Error(t('网盘同步文件缺少改动记录。'))
  return envelope.changes.map(validateFieldChange)
}

async function readBatch(files: RemoteFiles, name: string): Promise<ChangeBatch> {
  const envelope = parseEnvelope(await readChecked(files, name, batchPattern.exec(name)![1]!))
  if (!('blocks' in envelope)) return { name, changes: await readFields(files, envelope) }
  if (!Array.isArray(envelope.blocks) || envelope.blocks.length < 2) throw new Error(t('网盘同步批次清单无效。'))
  const changes: FieldChange[] = []
  for (const block of envelope.blocks) {
    const hash = typeof block === 'string' && blockPattern.exec(block)?.[1]
    if (!hash) throw new Error(t('网盘同步批次清单包含无效文件名。'))
    const body = await readChecked(files, block, hash)
    for (const change of await readFields(files, parseEnvelope(body))) changes.push(change)
  }
  return { name, changes }
}

async function ensureContent(files: RemoteFiles, names: Set<string>, file: NamedContent) {
  if (names.has(file.name) && await files.read(file.name) === file.body) return
  // PUT 失败可能留下截断内容；重试以同一内容寻址名称补齐原字节，读回一致才算上传完成。
  await files.write(file.name, file.body)
  if (await files.read(file.name) !== file.body) throw new Error(t('网盘同步文件写入后核对失败，请重新同步。'))
  names.add(file.name)
}

function blockName(batch: ChangeBatch) { return batch.name.replace('todou-changes-', 'todou-block-') }

async function publicationManifest(outgoing: ChangeBatch[]): Promise<NamedContent | null> {
  if (outgoing.length < 2) return null
  const body = JSON.stringify({ version: 1, blocks: outgoing.map(blockName) })
  const bytes = encoder.encode(body)
  if (bytes.length > maxFileBytes) throw new Error(t('单次同步的批次清单超过文件大小上限。'))
  return { name: 'todou-changes-v1-' + await sha256Hex(bytes) + '.json', body }
}

async function contentForUpload(batch: ChangeBatch) {
  const known = prepared.get(batch)
  if (known?.singleBody) return { name: known.name, body: known.singleBody, parts: [] }
  const rows = batch.changes.map(change => encodeChange(known ? change : validateFieldChange(change)))
  const encoded = await encodeBatch(rows, known)
  if (encoded.name !== batch.name) throw new Error(t('待上传的本机改动与批次名称不匹配。'))
  return encoded
}

export async function exchangeChangeBatches(
  files: RemoteFiles, seen: ReadonlySet<string>, outgoing: ChangeBatch[],
): Promise<{ incoming: ChangeBatch[]; acknowledged: string[] }> {
  const names = new Set(await files.list())
  const batches = [...names].filter(name => name.startsWith(batchNamespace)).sort()
  if (batches.some(name => !batchPattern.test(name))) throw new Error(t('网盘中存在无法识别的 ToDou 同步文件版本或名称。'))
  for (const batch of outgoing) {
    if (!batch.changes.length || !batchPattern.test(batch.name)) throw new Error(t('待上传的同步批次无效。'))
  }
  const manifest = await publicationManifest(outgoing)
  const publication = manifest?.name ?? outgoing[0]?.name
  for (const previous of seen) {
    if (previous !== publication && !names.has(previous)) {
      throw new Error(t('网盘目录缺少此前已同步的文件，请核对目录或恢复缺失文件后重试。'))
    }
  }

  async function publish() {
    if (!publication) return
    const alreadySeen = seen.has(publication) && names.has(publication)
    for (const batch of outgoing) {
      if (alreadySeen && prepared.has(batch)) continue
      const encoded = await contentForUpload(batch)
      if (alreadySeen) continue
      for (const part of encoded.parts) await ensureContent(files, names, part)
      await ensureContent(files, names, { name: manifest ? blockName(batch) : encoded.name, body: encoded.body })
    }
    // 多块共用一个最终 manifest；接收端只扫描 todou-changes-，不会把先传的块当作独立批次。
    if (manifest && !alreadySeen) await ensureContent(files, names, manifest)
  }
  // 先修复本机中断的发布，再读其他设备，避免双方都等对方修复残缺文件。
  const recovering = Boolean(publication && names.has(publication) && !seen.has(publication))
  if (recovering) await publish()
  const incoming: ChangeBatch[] = []
  for (const name of batches) {
    if (!seen.has(name) && name !== publication) incoming.push(await readBatch(files, name))
  }
  if (!recovering) await publish()
  return { incoming, acknowledged: publication ? [publication] : [] }
}
