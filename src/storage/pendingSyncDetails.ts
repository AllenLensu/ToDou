import type { FieldChange } from '../sync/fieldMerge'
import type { SqlRow } from './types'

type Kind = FieldChange['collection']
export interface PendingDetail {
  groupKind: Kind
  groupId: string
  groupTitle: string | null
  groupFields: number
  kind: Kind
  id: string
  title: string | null
  fields: number
}

export interface PendingDetailsPage {
  pending: number
  taskCount: number
  entries: PendingDetail[]
  nextOffset: number | null
  generation: string | null
  restoreId?: string
  revision: string
}

export const pendingPageSize = 32

// Classify only field addresses. The two fallback lookups extract a missing owner ID
// from its register without transferring notes, history snapshots or conflicts to the UI.
export function pendingDetailsSql(source: string) {
  return `WITH addresses AS (
    SELECT key, key->>0 AS collection, key->>1 AS recordId, key->>2 AS field FROM ${source}
  ), parts AS (
    SELECT collection, recordId,
      CASE
        WHEN collection='tasks' AND field GLOB 'tag:*' THEN 'tags'
        WHEN collection='tasks' AND field='categoryId' THEN 'categories'
        WHEN collection='settings' AND recordId GLOB 'purged_task:*' THEN 'tasks'
        WHEN collection='settings' AND recordId GLOB 'purged_checklist:*' THEN 'checklistItems'
        WHEN collection='settings' AND recordId GLOB 'tag_visibility:*' THEN 'tags'
        WHEN collection='settings' AND recordId='reminder_runtime' AND field GLOB 'snooze:task:*' THEN 'tasks'
        WHEN collection='settings' AND recordId='reminder_runtime' AND field GLOB 'snooze:checklist:*' THEN 'checklistItems'
        ELSE collection END AS kind,
      CASE
        WHEN collection='tasks' AND field GLOB 'tag:*' THEN substr(field,5)
        WHEN collection='settings' AND recordId GLOB 'purged_task:*' THEN substr(recordId,13)
        WHEN collection='settings' AND recordId GLOB 'purged_checklist:*' THEN substr(recordId,18)
        WHEN collection='settings' AND recordId GLOB 'tag_visibility:*' THEN substr(recordId,16)
        WHEN collection='settings' AND field GLOB 'snooze:task:*' THEN substr(field,13)
        WHEN collection='settings' AND field GLOB 'snooze:checklist:*' THEN substr(field,18)
        ELSE recordId END AS itemId,
      count(*) AS fields
    FROM addresses GROUP BY collection, recordId, kind, itemId
  ), owners AS (
    SELECT p.*, CASE
      WHEN collection='tasks' THEN recordId
      WHEN kind='tasks' THEN itemId
      WHEN kind='checklistItems' THEN coalesce(c.task_id,
        (SELECT json_extract(versions,'$[0].value') FROM sync_fields WHERE key=json_array('checklistItems',itemId,'taskId')))
      WHEN kind='history' THEN coalesce(h.task_id,
        (SELECT json_extract(versions,'$[0].value.taskId') FROM sync_fields WHERE key=json_array('history',itemId,'entry')))
      WHEN kind='relations' THEN json_extract(itemId,'$[0]')
      END AS owner
    FROM parts p
    LEFT JOIN checklist_items c ON kind='checklistItems' AND c.id=itemId
    LEFT JOIN task_history h ON kind='history' AND h.id=itemId
  ), members AS (
    SELECT CASE WHEN owner IS NULL THEN kind ELSE 'tasks' END AS groupKind,
      coalesce(owner,itemId) AS groupId, kind,
      CASE WHEN owner IS NOT NULL AND kind IN ('history','relations','categories') THEN '' ELSE itemId END AS id,
      sum(fields) AS fields
    FROM owners GROUP BY groupKind, groupId, kind, id
  ), ranked AS (
    SELECT *, sum(fields) OVER (PARTITION BY groupKind,groupId) AS groupFields,
      row_number() OVER (PARTITION BY groupKind,groupId ORDER BY kind,id) AS member
    FROM members
  ), page AS (
    SELECT *, sum(fields) OVER () AS pending,
      sum(CASE WHEN groupKind='tasks' AND member=1 THEN 1 ELSE 0 END) OVER () AS taskCount
    FROM ranked ORDER BY (groupKind='tasks') DESC,groupKind,groupId,kind,id LIMIT $limit OFFSET $offset
  )
  SELECT p.*, coalesce(t.title, c.title, tag.name, cat.name) AS title,
    CASE WHEN groupKind='tasks' THEN ownerTask.title ELSE coalesce(c.title, tag.name, cat.name) END AS groupTitle,
    total_changes() || '/' || (SELECT data_version FROM pragma_data_version) AS revision
  FROM page p
  LEFT JOIN tasks ownerTask ON groupKind='tasks' AND ownerTask.id=groupId
  LEFT JOIN tasks t ON kind='tasks' AND t.id=p.id
  LEFT JOIN checklist_items c ON kind='checklistItems' AND c.id=p.id
  LEFT JOIN tags tag ON kind='tags' AND tag.id=p.id
  LEFT JOIN categories cat ON kind='categories' AND cat.id=p.id
  ORDER BY (groupKind='tasks') DESC,groupKind,groupId,kind,p.id`
}

export function pendingDetailsPage(rows: SqlRow[], offset: number, generation: string | null, restoreId?: string): PendingDetailsPage {
  return {
    generation, restoreId, revision: String(rows[0]?.revision ?? ''),
    pending: Number(rows[0]?.pending ?? 0), taskCount: Number(rows[0]?.taskCount ?? 0),
    nextOffset: rows.length > pendingPageSize ? offset + pendingPageSize : null,
    entries: rows.slice(0, pendingPageSize).map(row => ({
      groupKind: row.groupKind as Kind, groupId: String(row.groupId), groupTitle: row.groupTitle as string | null,
      groupFields: Number(row.groupFields), kind: row.kind as Kind, id: String(row.id),
      title: row.title as string | null, fields: Number(row.fields),
    })),
  }
}
