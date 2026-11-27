import { t } from '../i18n'
import { pendingDetailsPage, pendingDetailsSql, pendingPageSize } from './pendingSyncDetails'
import { isPersistedDate, projectHistoryDates, taskDateFields } from '../domain/persistedDate'
// 字段寄存器、待传及在途批次共用业务写事务；网络阶段不占用此事务。
import type { Database } from '@sqlite.org/sqlite-wasm'
import { diffSyncSnapshots, fieldKey, materializeFields, mergeFieldChanges, resolveField,
  type FieldChange, type FieldValue } from '../sync/fieldMerge'
import { rowsFor } from './database'
import { restoreMetaPrefix } from '../sync/sharedRestore'
import { applyTaskPurges, checklistPurgePrefix, isPurgeKey, purgedRegisterKeysSql } from '../sync/taskPurge'
import { emptyFieldSnapshot, takeFieldImages } from './fieldSyncCapture'
import type { SyncSnapshot } from './types'

type FieldState = Map<string, FieldChange[]>
type Register = { versions: FieldChange[]; known: boolean }
const restoredMessage = () => t('导入或恢复后已暂停同步。请确认要合并当前清单，再重新启用同步。')

// Historical entries are immutable, so older malformed date strings cannot be fixed by editing the task.
// Project only those optional dates on local reads; incoming packets still undergo strict validation.
function readVersions(raw: string): FieldChange[] {
  const changes: FieldChange[] = JSON.parse(raw)
  for (const change of changes) {
    const entry = change.value
    if (change.collection === 'history' && entry && typeof entry === 'object' && 'snapshot' in entry &&
      entry.snapshot && typeof entry.snapshot === 'object') entry.snapshot = projectHistoryDates(entry.snapshot)
  }
  return changes
}

function batches<T>(items: T[], consume: (batch: T[]) => void) {
  // 首次交换万条任务时分批传入，限制 SQLite/WASM 单次字符串分配。
  for (let i = 0; i < items.length; i += 512) consume(items.slice(i, i + 512))
}

function rowKey(collection: keyof SyncSnapshot, row: SyncSnapshot[keyof SyncSnapshot][number]) {
  if ('key' in row) return row.key
  if ('id' in row) return row.id
  if (collection === 'relations') return JSON.stringify([row.taskId, row.relatedTaskId].sort())
  throw new Error(t('无法识别同步记录。'))
}

/** 字段物化已协调时间戳；这里只落下实际变化的行，不再用整行时间戳筛掉字段合并结果。 */
function updatedRows(before: SyncSnapshot, after: SyncSnapshot) {
  const result = emptyFieldSnapshot()
  for (const name of Object.keys(after) as Array<keyof SyncSnapshot>) {
    const previous = new Map(before[name].map(row => [rowKey(name, row), row] as const))
    for (const row of after[name]) {
      if (JSON.stringify(previous.get(rowKey(name, row))) !== JSON.stringify(row))
        (result[name] as Array<typeof row>).push(row)
    }
  }
  return result
}

export function createFieldSyncStorage(db: Database, readSnapshot: () => SyncSnapshot,
  applyMerged: (changed: SyncSnapshot, removed: { tasks: string[]; categories: string[]; tags: string[] }) => void) {
  const marker = (key: string) => rowsFor(db, 'SELECT 1 FROM sync_meta WHERE key=$key', { '$key': key }).length > 0
  function putRegisters(entries: Array<[string, FieldChange[]]>, seedOnly = false) {
    batches(entries, batch => db.exec({
      sql: `INSERT INTO sync_fields(key,versions) SELECT value->>0, value->1 FROM json_each($rows) WHERE true
        ON CONFLICT(key) ${seedOnly ? 'DO NOTHING' :
          'DO UPDATE SET versions=excluded.versions WHERE versions<>excluded.versions'}`,
      bind: { '$rows': JSON.stringify(batch) },
    }))
  }
  function seed(snapshot: SyncSnapshot) {
    const initial = diffSyncSnapshots(emptyFieldSnapshot(), snapshot)
    putRegisters(initial.map(change => [fieldKey(change), [change]]), true)
  }
  function registers(keys: string[], scope: string | null) {
    const found = new Map<string, Register>()
    batches(keys, batch => {
      for (const row of rowsFor(db, `SELECT f.key, f.versions, p.key AS pending_key
        FROM sync_fields f LEFT JOIN sync_pending p ON p.scope=$scope AND p.key=f.key
        WHERE f.key IN (SELECT value FROM json_each($keys))`, { '$scope': scope, '$keys': JSON.stringify(batch) })) {
        found.set(String(row.key), { versions: readVersions(String(row.versions)), known: scope !== null && row.pending_key === null })
      }
    })
    return found
  }
  function recordLocal() {
    const { before, after } = takeFieldImages(db)
    // 尚未全量播种时，先按旧行原时间戳补齐字段，再记本次编辑；未选网盘也要保留此基线。
    if (!marker('seeded')) seed(before)
    const changes = diffSyncSnapshots(before, after)
    const old = registers(changes.map(fieldKey), null)
    putRegisters(changes.map(change => {
      const key = fieldKey(change)
      const latest = old.get(key)?.versions[0]
      // 顺序编辑必须晚于已观察版本，避免同毫秒连改或对端时钟超前制造本机同刻冲突。
      const at = latest && Date.parse(change.at) <= Date.parse(latest.at)
        ? new Date(Date.parse(latest.at) + 1).toISOString() : change.at
      return [key, [{ ...change, at }]]
    }))
    if (after.settings.some(setting => isPurgeKey(setting.key))) prunePurgedRegisters()
  }
  function prunePurgedRegisters() {
    const keys = rowsFor(db, purgedRegisterKeysSql).map(row => String(row.key))
    batches(keys, batch => {
      const bind = { '$keys': JSON.stringify(batch) }
      const selected = 'key IN (SELECT value FROM json_each($keys))'
      // A network request may still need to acknowledge its exact frozen bytes.
      db.exec({ sql: `UPDATE sync_outbox SET held_versions=(SELECT versions FROM sync_fields WHERE key=sync_outbox.key)
        WHERE held_versions IS NULL AND ${selected}`, bind })
      db.exec({ sql: `DELETE FROM sync_pending WHERE ${selected}`, bind })
      db.exec({ sql: `DELETE FROM sync_fields WHERE ${selected}`, bind })
    })
  }
  function reconcileTaskPurges(marker?: SyncSnapshot['settings'][number]) {
    if (!marker && !rowsFor(db, "SELECT 1 FROM task_settings WHERE key GLOB 'purged_task:*' OR key GLOB 'purged_checklist:*' LIMIT 1").length) return
    const local = readSnapshot()
    const result = structuredClone(local)
    if (marker) result.settings.push(marker)
    applyTaskPurges(result)
    const retained = new Set(result.tasks.map(task => task.id))
    applyMerged(updatedRows(local, result), { tasks: local.tasks.filter(task => !retained.has(task.id)).map(task => task.id), tags: [], categories: [] })
  }
  function getDevice(scope: string) {
    if (!scope.trim()) throw new Error(t('请选择同步目录。'))
    return rowsFor(db, 'SELECT * FROM sync_devices WHERE scope=$scope', { '$scope': scope })[0]
  }
  function ensureDevice(scope: string, explicitlyEnable = false) {
    const existing = getDevice(scope)
    if ((existing ? existing.paused === 1 : marker('restored')) && !explicitlyEnable) throw new Error(restoredMessage())
    if (!existing) {
      db.exec({ sql: 'INSERT INTO sync_devices(scope,generation) VALUES ($scope,lower(hex(randomblob(16))))',
        bind: { '$scope': scope } })
    } else if (existing.paused) {
      db.exec({ sql: 'UPDATE sync_devices SET paused=0 WHERE scope=$scope', bind: { '$scope': scope } })
    }
    if (!marker('seeded')) {
      seed(readSnapshot())
      db.exec("INSERT INTO sync_meta VALUES ('seeded')")
    }
    return String((existing ?? getDevice(scope))!.generation)
  }
  // 按稳定顺序读取冻结批次；发送期间再改字段时，schema 触发器保留旧版本，其余仍引用寄存器。
  const flightRows = `SELECT coalesce(o.held_versions,f.versions) FROM sync_outbox o
    LEFT JOIN sync_fields f ON f.key=o.key WHERE o.scope=$scope ORDER BY o.key`
  function visitFlight(scope: string, visit: (versions: FieldChange[]) => void) {
    db.exec({ sql: flightRows, bind: { '$scope': scope }, rowMode: 'array',
      callback(row) { visit(readVersions(String(row[0]))) } })
  }
  function sharedBinding(scope: string) {
    const prefix = restoreMetaPrefix(scope)
    const rows = rowsFor(db, 'SELECT key FROM sync_meta WHERE substr(key,1,length($prefix))=$prefix', { '$prefix': prefix })
    if (!rows.length) return { scope }
    const restoreId = String(rows[0]!.key).slice(prefix.length)
    return { scope: scope + ':restore:' + restoreId, restoreId }
  }

  function prepare(provider: string) {
    const { scope, ...accepted } = sharedBinding(provider)
    const generation = ensureDevice(scope)
    const flight = rowsFor(db, 'SELECT 1 FROM sync_outbox WHERE scope=$scope LIMIT 1', { '$scope': scope })
    // 未确认批次原样重试，不吸收其后新增的待传字段；网络请求在此存储操作结束后进行。
    if (flight.length) {
      // A legacy invalid date could never have been published. Rebind just its frozen key
      // to the corrected register; other frozen fields and later pending edits stay separate.
      const held = rowsFor(db, `SELECT o.key,o.held_versions,f.versions FROM sync_outbox o
        JOIN sync_fields f ON f.key=o.key WHERE o.scope=$scope AND o.held_versions IS NOT NULL
        AND json_extract(o.key,'$[0]') IN ('tasks','checklistItems')
        AND json_extract(o.key,'$[2]') IN (SELECT value FROM json_each($dates))`,
        { '$scope': scope, '$dates': JSON.stringify(taskDateFields) })
      const validDate = (change: FieldChange) => change.value === null || isPersistedDate(change.value)
      for (const row of held) {
        if (!readVersions(String(row.held_versions)).every(validDate) && readVersions(String(row.versions)).every(validDate)) {
          db.exec({ sql: 'UPDATE sync_outbox SET held_versions=NULL WHERE scope=$scope AND key=$key',
            bind: { '$scope': scope, '$key': String(row.key) } })
        }
      }
    } else {
      db.exec({ sql: 'INSERT INTO sync_outbox(scope,key) SELECT scope,key FROM sync_pending WHERE scope=$scope',
        bind: { '$scope': scope } })
    }
    const changes: FieldChange[] = []
    visitFlight(scope, versions => { for (const change of versions) changes.push(change) })
    const seen = rowsFor(db, 'SELECT name FROM sync_seen WHERE scope=$scope', { '$scope': scope }).map(row => String(row.name))
    return { changes, seen, generation, ...accepted }
  }
  function applyFields(state: FieldState, choosingConflict = false) {
    const derived = new Set<string>()
    if (!state.size) return derived
    // Keep the original IDs of same-name tags/categories available to map references
    // from later packages, even after the duplicate was removed from the visible rows.
    const tagNames = new Map<string, string[]>()
    const taggedAliases = new Set<string>()
    for (const collection of ['tags', 'categories']) {
      const prefix = '["' + collection + '",'
      for (const row of rowsFor(db, 'SELECT key,versions FROM sync_fields WHERE key >= $start AND key < $end',
        { '$start': prefix, '$end': prefix + '\uffff' })) {
        const key = String(row.key)
        const versions: FieldChange[] = state.get(key) ?? JSON.parse(String(row.versions))
        state.set(key, versions)
        const field = versions[0]!
        if (collection === 'tags' && field.field.startsWith('alias:')) {
          taggedAliases.add(field.id)
          taggedAliases.add(field.field.slice(6))
        }
        if (collection === 'tags' && field.field === 'name') {
          const name = String(field.value).replace(/[A-Z]/g, c => c.toLowerCase())
          const ids = tagNames.get(name) ?? []
          ids.push(field.id)
          tagNames.set(name, ids)
        }
      }
    }
    const local = readSnapshot()
    // If a newer snooze arrived before the corresponding reschedule, retain it
    // after replacing this device's previous notification cycle.
    const schedules = new Map<string, string>()
    for (const versions of state.values()) {
      const field = versions[0]!
      if (field.field !== 'remindAt' || (field.collection !== 'tasks' && field.collection !== 'checklistItems')) continue
      const item = (field.collection === 'tasks' ? 'task:' : 'checklist:') + field.id
      schedules.set(fieldKey({ collection: 'settings', id: 'reminder_runtime', field: 'snooze:' + item }), field.at)
    }
    for (const [key, saved] of registers([...schedules.keys()], null)) {
      if (!state.has(key) && saved.versions[0]!.at >= schedules.get(key)!) state.set(key, saved.versions)
    }
    for (const ids of tagNames.values()) if (ids.length > 1) for (const id of ids) taggedAliases.add(id)
    if (taggedAliases.size) {
      const affected = new Set(local.tasks.filter(task => task.tagIds.some(id => taggedAliases.has(id))).map(task => task.id))
      for (const versions of state.values()) {
        const field = versions[0]!
        if (field.collection === 'tasks' && field.field.startsWith('tag:') && taggedAliases.has(field.field.slice(4))) affected.add(field.id)
      }
      const prefixes = [...affected].map(id => JSON.stringify(['tasks', id]).slice(0, -1) + ',"tag:')
      batches(prefixes, batch => {
        for (const row of rowsFor(db, `SELECT f.key,f.versions FROM json_each($prefixes) p CROSS JOIN sync_fields f
          WHERE f.key >= p.value AND f.key < p.value || char(1114111)`, { '$prefixes': JSON.stringify(batch) })) {
          if (!state.has(String(row.key))) state.set(String(row.key), JSON.parse(String(row.versions)))
        }
      })
    }
    const merged = materializeFields(state, local, ({ id, parentTaskId }) => {
      if (choosingConflict) throw new Error(t('选择此父任务会形成循环。请先调整另一条父子关系。'))
      const key = fieldKey({ collection: 'tasks', id, field: 'parentTaskId' })
      const versions = registers([key], null).get(key)?.versions ?? []
      const parent = versions.find(change => change.value === parentTaskId)
      if (!parent) throw new Error(t('找不到形成父子循环的字段版本。'))
      // Both alternatives remain available. The safe local view is the unparented row.
      putRegisters([[key, [{ ...parent, value: null }, ...versions.filter(change => change.value !== null)]]])
      derived.add(key)
    }, alias => {
      const key = fieldKey(alias)
      putRegisters([[key, [alias]]])
      derived.add(key)
    }, correction => {
      // Old clients read the ordinary batches without purge markers. Make surviving
      // children and their history independently valid in those batches as well.
      const key = fieldKey(correction)
      const previous = registers([key], null).get(key)?.versions[0]
      if (!previous || JSON.stringify(previous.value) === JSON.stringify(correction.value)) return
      const at = new Date(Date.parse(previous.at) + 1).toISOString()
      putRegisters([[key, [{ ...correction, at }]]])
      derived.add(key)
    })
    const tags = new Set(merged.tags.map(tag => tag.id)), categories = new Set(merged.categories.map(category => category.id))
    const changed = updatedRows(local, merged)
    const taskIds = new Set(merged.tasks.map(task => task.id))
    applyMerged(changed, {
      tasks: local.tasks.filter(task => !taskIds.has(task.id)).map(task => task.id),
      tags: local.tags.filter(tag => !tags.has(tag.id)).map(tag => tag.id),
      categories: local.categories.filter(category => !categories.has(category.id)).map(category => category.id),
    })
    // An offline device may have added checklist items the deleting device never saw.
    for (const setting of changed.settings) {
      if (!setting.key.startsWith(checklistPurgePrefix)) continue
      const marker: FieldChange = { collection: 'settings', id: setting.key, field: 'value', value: setting.value, at: setting.updatedAt }
      const key = fieldKey(marker)
      if (!state.has(key)) {
        putRegisters([[key, [marker]]])
        derived.add(key)
      }
    }
    if (merged.settings.some(setting => isPurgeKey(setting.key))) prunePurgedRegisters()
    return derived
  }
  function finish(provider: string, incoming: Array<{ name: string; changes: FieldChange[] }>,
    sent: FieldChange[], acknowledged: string[], expectedGeneration?: string) {
    const { scope } = sharedBinding(provider)
    const generation = ensureDevice(scope)
    // 恢复会换代并暂停；调用者传回准备时的代次，重新启用后仍不能接纳旧网络结果。
    if (expectedGeneration !== undefined && generation !== expectedGeneration) throw new Error(restoredMessage())
    const seen = new Set(rowsFor(db, 'SELECT name FROM sync_seen WHERE scope=$scope', { '$scope': scope }).map(row => String(row.name)))
    if (sent.length) {
      if (!acknowledged.length) throw new Error(t('网盘尚未确认本次上传批次。'))
      let index = 0, matches = true
      visitFlight(scope, versions => {
        for (const change of versions) {
          const given = sent[index++]
          if (!given || fieldKey(given) !== fieldKey(change) || given.at !== change.at ||
            JSON.stringify(given.value) !== JSON.stringify(change.value)) matches = false
        }
      })
      // 只确认实际发送的冻结版本；已处理过的重复确认可幂等通过，不能清掉另一批 outbox。
      if (matches && index === sent.length) {
        db.exec({ sql: 'DELETE FROM sync_outbox WHERE scope=$scope', bind: { '$scope': scope } })
      } else if (!acknowledged.every(name => seen.has(name))) {
        throw new Error(t('本机待上传批次与本次确认不符，请重新同步。'))
      }
    }
    const received = incoming.filter(packet => !seen.has(packet.name))
    const incomingChanges = received.flatMap(packet => packet.changes)
    const known = new Map<string, Set<string>>()
    const remember = (change: FieldChange) => {
      const key = fieldKey(change)
      const values = known.get(key) ?? new Set<string>()
      values.add(JSON.stringify([change.at, change.value]))
      known.set(key, values)
    }
    for (const change of sent) remember(change)
    for (const change of incomingChanges) remember(change)
    const old = registers([...known.keys()], scope)
    const state: FieldState = new Map()
    for (const change of incomingChanges) {
      const key = fieldKey(change)
      const previous = old.get(key)
      if (previous && !state.has(key)) state.set(key, previous.versions.slice())
    }
    for (const register of old.values()) if (register.known) for (const change of register.versions) remember(change)
    mergeFieldChanges(state, incomingChanges)
    const changed = new Map([...state].filter(([key, versions]) => JSON.stringify(old.get(key)?.versions) !== JSON.stringify(versions)))
    let derived = new Set<string>()
    if (changed.size) {
      putRegisters([...changed])
      derived = applyFields(changed)
    }
    // 仅清除对端已知的精确版本；上传期间产生的新编辑或派生冲突仍留在待传队列。
    const confirmed: string[] = []
    for (const [key, values] of known) {
      const versions = state.get(key) ?? old.get(key)?.versions
      if (!derived.has(key) && versions?.every(change => values.has(JSON.stringify([change.at, change.value])))) confirmed.push(key)
    }
    batches(confirmed, keys => db.exec({
      sql: 'DELETE FROM sync_pending WHERE scope=$scope AND key IN (SELECT value FROM json_each($keys))',
      bind: { '$scope': scope, '$keys': JSON.stringify(keys) },
    }))
    const names = [...new Set([...acknowledged, ...received.map(packet => packet.name)])]
    batches(names, batch => db.exec({ sql: 'INSERT OR IGNORE INTO sync_seen SELECT $scope,value FROM json_each($names)',
      bind: { '$scope': scope, '$names': JSON.stringify(batch) } }))
    db.exec({ sql: 'UPDATE sync_devices SET last_success=$now WHERE scope=$scope',
      bind: { '$now': new Date().toISOString(), '$scope': scope } })
  }
  function pendingSource(provider: string) {
    const { scope, ...accepted } = sharedBinding(provider)
    const device = getDevice(scope)
    const source = device ? '(SELECT key FROM sync_pending WHERE scope=$scope)' : 'sync_fields'
    const bind: Record<string, string | number> = device ? { '$scope': scope } : {}
    return { source, bind, device, accepted }
  }
  function pendingDetails(provider: string, offset = 0) {
    const { source, bind, device, accepted } = pendingSource(provider)
    const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0
    const rows = rowsFor(db, pendingDetailsSql(source), { ...bind, '$offset': start, '$limit': pendingPageSize + 1 })
    return pendingDetailsPage(rows, start, device ? String(device.generation) : null, accepted.restoreId)
  }
  function status(provider: string) {
    const { source, bind, device, accepted } = pendingSource(provider)
    const pending = Number(rowsFor(db, 'SELECT count(*) AS n FROM ' + source, bind)[0]?.n)
    const conflicts = rowsFor(db, 'SELECT key,versions FROM sync_fields WHERE json_array_length(versions)>1')
      .map(row => ({ key: String(row.key), versions: readVersions(String(row.versions)) }))
    return { ...accepted, generation: device ? String(device.generation) : null, pending, conflicts, lastSuccess: typeof device?.last_success === 'string' ? device.last_success : null,
      paused: device ? Boolean(device.paused) : marker('restored') }
  }
  function choose(provider: string, key: string, value: FieldValue) {
    const { scope } = sharedBinding(provider)
    ensureDevice(scope)
    const versions = registers([key], scope).get(key)?.versions
    if (!versions || versions.length < 2) throw new Error(t('此字段已没有待选的冲突版本。'))
    const state: FieldState = new Map([[key, versions]])
    const at = new Date(Math.max(Date.now(), ...versions.map(change => Date.parse(change.at) + 1))).toISOString()
    const change = resolveField(state, key, value, at)
    const selected: FieldState = new Map([[key, [change]]])
    putRegisters([...selected])
    applyFields(selected, true)
  }
  return { recordLocal, reconcileTaskPurges, prepare, finish, status, pendingDetails, choose, enable: (provider: string) => {
    const { scope } = sharedBinding(provider)
    ensureDevice(scope, true)
  } }
}
