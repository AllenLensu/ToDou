import type { Database } from '@sqlite.org/sqlite-wasm'
import { rowsFor } from './database'
import type { SyncSnapshot } from './types'

export const emptyFieldSnapshot = (): SyncSnapshot => ({
  tasks: [], checklistItems: [], relations: [], categories: [], tags: [], history: [], settings: [],
})

// 前后镜像使用同一投影，标签关联修改前也捕获任务的完整标签集合。
const sources = [
  ['tasks', 'tasks', 'id title notes url priority status dueAt remindAt categoryId parentTaskId recurrenceRule recurrenceSeriesId occurrenceAt completionStrategy reminderSettings createdAt updatedAt deletedAt tagIds'],
  ['checklistItems', 'checklist_items', 'id taskId title notes completed remindAt recurrenceRule recurrenceMode createdAt updatedAt deletedAt'],
  ['relations', 'task_relations', 'taskId relatedTaskId kind createdAt updatedAt deletedAt'],
  ['categories', 'categories', 'id name completionStrategy followUpMinutes createdAt updatedAt'],
  ['tags', 'tags', 'id name createdAt updatedAt'],
  ['history', 'task_history', 'id taskId operation snapshot createdAt'],
  ['settings', 'task_settings', 'key value updatedAt'],
] as const

function projection(properties: string, alias: string) {
  const fields = properties.split(' ').map(property => {
    const column = alias + '.' + property.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())
    let expression = column
    if (property === 'completed') expression = `json(CASE WHEN ${column} THEN 'true' ELSE 'false' END)`
    if (property === 'tagIds') expression = `json((SELECT json_group_array(tag_id ORDER BY tag_id) FROM task_tags WHERE task_id = ${alias}.id))`
    if (property === 'reminderSettings' || property === 'snapshot') {
      const raw = property === 'snapshot' ? alias + '.snapshot_json' : column
      expression = `json(CASE WHEN json_valid(${raw}) THEN ${raw} ELSE NULL END)`
    }
    return `'${property}', ${expression}`
  })
  return `json_object(${fields.join(', ')})`
}

/** 连接级 TEMP 触发器捕获级联改动，与业务事务一起回滚；每行只留本轮首次改动前像。 */
export function installFieldCapture(db: Database) {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS field_before (
      collection TEXT NOT NULL, row_id INTEGER NOT NULL, image TEXT, PRIMARY KEY(collection, row_id)
    ) WITHOUT ROWID;
    CREATE TEMP TABLE IF NOT EXISTS skip_field_capture (flag INTEGER PRIMARY KEY);`)
  const enabled = 'WHEN NOT EXISTS (SELECT 1 FROM skip_field_capture)'
  const ignoreRepeat = 'ON CONFLICT(collection,row_id) DO NOTHING'
  // 新增用 AFTER 取得 rowid 并记空前像；更新／删除在 BEFORE 留旧值，后像统一在收尾查询。
  for (const [collection, table, properties] of sources) {
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      const insert = event === 'INSERT'
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS capture_${table}_${event}
        ${insert ? 'AFTER' : 'BEFORE'} ${event} ON main.${table} ${enabled} BEGIN
        INSERT INTO field_before VALUES('${collection}', ${insert ? 'NEW' : 'OLD'}.rowid,
          ${insert ? 'NULL' : projection(properties, 'OLD')}) ${ignoreRepeat}; END`)
    }
  }
  for (const event of ['INSERT', 'DELETE']) {
    const task = event === 'INSERT' ? 'NEW.task_id' : 'OLD.task_id'
    db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS capture_task_tags_${event}
      BEFORE ${event} ON main.task_tags ${enabled} BEGIN
      INSERT INTO field_before SELECT 'tasks', t.rowid, ${projection(sources[0][2], 't')}
        FROM tasks t WHERE t.id = ${task} ${ignoreRepeat}; END`)
  }
}

/** 只读取本轮触及行的前后像并清空缓存；缺失前像或后像分别表示新增或物理删除。 */
export function takeFieldImages(db: Database) {
  const before = emptyFieldSnapshot(), after = emptyFieldSnapshot()
  const collections = rowsFor(db, 'SELECT DISTINCT collection FROM field_before')
  for (const row of collections) {
    const source = sources.find(([collection]) => collection === row.collection)!
    const [collection, table, properties] = source
    const images = rowsFor(db, `SELECT b.image AS previous,
        CASE WHEN t.rowid IS NOT NULL THEN ${projection(properties, 't')} END AS current
      FROM field_before b LEFT JOIN ${table} t ON t.rowid = b.row_id
      WHERE b.collection = $collection`, { '$collection': collection })
    for (const image of images) {
      if (typeof image.previous === 'string') before[collection].push(JSON.parse(image.previous))
      if (typeof image.current === 'string') after[collection].push(JSON.parse(image.current))
    }
  }
  if (collections.length) db.exec('DELETE FROM field_before')
  return { before, after }
}
