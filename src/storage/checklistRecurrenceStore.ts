import { t } from '../i18n'
import { calendarAt, completionAt, encodeRecurrenceRule, futureField, parseRecurrenceRule, recurrenceOptions, type RecurrenceScope, type ScheduleSegment } from '../domain/recurrence'
import { hasChecklistRecurrenceMetadata, checklistOccurrenceId, readChecklistRecurrence, storeChecklistRecurrence, type ChecklistRecurrence, type ChecklistSeriesPlan } from '../domain/checklistRecurrence'
import { rowsFor } from './database'
import type { createStoreHelpers } from './helpers'
import { checklistFromRow, nowIso } from './transform'
import type { ChecklistItem, ChecklistItemInput } from './types'
import { upcomingSlots } from '../domain/recurrence'

type Helpers = ReturnType<typeof createStoreHelpers>
type ClearReminder = (kind: 'task' | 'checklist', id: string, before: string | null, after: string | null) => unknown
const basis = (segment: ScheduleSegment) => JSON.stringify(segment)
const segmentFor = (plan: ChecklistSeriesPlan,index: number) => [...plan.segments].reverse().find(segment=>segment.index<=index)!
const isRetired = (item: ChecklistItem) => Boolean(item.deletedAt && readChecklistRecurrence(item.recurrenceRule)?.retiredAt === item.deletedAt)

/** 独立检查项的系列计划和期次写入；由 TaskStore 的写队列、事务及持久化统一包裹。 */
export function createChecklistRecurrenceStorage(h: Helpers, clearReminder: ClearReminder) {
  const { db } = h
  const all = () => rowsFor(db, 'SELECT * FROM checklist_items').map(checklistFromRow)
  function write(item: ChecklistItem, rule: string | null, remindAt = item.remindAt) {
    db.exec({sql:'UPDATE checklist_items SET recurrence_rule=$rule, remind_at=$remind, updated_at=$updated WHERE id=$id',
      bind:{'$rule':rule,'$remind':remindAt,'$updated':nowIso(),'$id':item.id}})
    clearReminder('checklist',item.id,item.remindAt,remindAt)
    return {...item,recurrenceRule:rule,remindAt}
  }
  function untouched(item: ChecklistItem, plan: ChecklistSeriesPlan) {
    return !item.completed && !readChecklistRecurrence(item.recurrenceRule)?.exception && item.title===plan.template.title && item.notes===plan.template.notes
  }
  function retire(item: ChecklistItem) {
    const metadata=readChecklistRecurrence(item.recurrenceRule),rule=parseRecurrenceRule(item.recurrenceRule)
    if (item.deletedAt || !metadata || !rule) return item
    const at=nowIso(),raw=storeChecklistRecurrence(rule,{...metadata,retiredAt:at})
    db.exec({sql:'UPDATE checklist_items SET deleted_at=$at, updated_at=$at, recurrence_rule=$rule WHERE id=$id',bind:{'$at':at,'$rule':raw,'$id':item.id}})
    clearReminder('checklist',item.id,item.remindAt,null)
    return {...item,deletedAt:at,recurrenceRule:raw}
  }
  function deactivate(item: ChecklistItem) {
    const metadata=readChecklistRecurrence(item.recurrenceRule),rule=parseRecurrenceRule(item.recurrenceRule)
    if(item.deletedAt || !metadata?.active || !rule) return item
    return write(item,storeChecklistRecurrence(rule,{...metadata,active:false}))
  }
  // A normal stop retains overdue work; complete-all also completes late forecasts a peer had made offline.
  function applyStop(item: ChecklistItem, plan: ChecklistSeriesPlan) {
    const metadata=readChecklistRecurrence(item.recurrenceRule),rule=parseRecurrenceRule(item.recurrenceRule)
    if(item.deletedAt || !metadata || !rule) return item
    if(metadata.index>0 && metadata.at>(plan.stoppedAt??'') && untouched(item,plan)) return retire(item)
    if(plan.completeAllAt && metadata.completedFor!==plan.completeAllAt) {
      const raw=storeChecklistRecurrence(rule,{...metadata,active:false,completedAt:metadata.completedAt??plan.completeAllAt,completedFor:plan.completeAllAt})
      db.exec({sql:'UPDATE checklist_items SET completed=1, recurrence_rule=$rule, updated_at=$updated WHERE id=$id',
        bind:{'$rule':raw,'$updated':nowIso(),'$id':item.id}})
      clearReminder('checklist',item.id,item.remindAt,null)
      return {...item,completed:true,recurrenceRule:raw}
    }
    return deactivate(item)
  }
  // Content edits remain local to a period, while its unmodified reminder follows the effective plan.
  function align(item: ChecklistItem, segment: ScheduleSegment, plan: ChecklistSeriesPlan) {
    const metadata=readChecklistRecurrence(item.recurrenceRule)
    if(!metadata || item.deletedAt || item.completed) return item
    const at=segment.mode==='calendar'?calendarAt(segment,metadata.index,plan.zone):
      metadata.generatedFor?completionAt(segment,metadata.generatedFor,plan.zone):null
    return at?write(item,storeChecklistRecurrence(segment,{...metadata,basis:basis(segment),at}),metadata.timeException?item.remindAt:at):item
  }
  // 跟随父任务生成的副本可能保留系列元数据；须同时核对所属任务和期次 ID，不能跨父任务改写。
  function belongsToRoot(item: ChecklistItem, root: ChecklistItem, metadata: ChecklistRecurrence) {
    return item.taskId === root.taskId && metadata.series === root.id &&
      item.id === checklistOccurrenceId(root.id, metadata.index, metadata.generation ?? 0)
  }
  function seriesEntries(root: ChecklistItem,generation: number) {
    return all().filter(item=>{
      const m=readChecklistRecurrence(item.recurrenceRule)
      return m && (m.generation??0)===generation && belongsToRoot(item,root,m)
    })
  }
  function prepare(current: ChecklistItem | null, next: ChecklistItem, scope: RecurrenceScope = 'this'): ChecklistItemInput {
    const original=readChecklistRecurrence(current?.recurrenceRule),rule=parseRecurrenceRule(next.recurrenceRule)
    const originalRule=parseRecurrenceRule(current?.recurrenceRule)
    if (hasChecklistRecurrenceMetadata(next.recurrenceRule) && !readChecklistRecurrence(next.recurrenceRule)) return next
    const explicitlyEnabled=Boolean(rule && next.recurrenceMode==='independent' &&
      (!original || current?.recurrenceMode!=='independent' || (!original.active && next.recurrenceRule!==current?.recurrenceRule)))
    if (explicitlyEnabled) {
      if (!next.remindAt || !Number.isFinite(Date.parse(next.remindAt))) throw new Error(t('启用独立重复前请设置有效提醒时间'))
      // 显式重启根项时换代，使新期次与离线设备仍持有的旧期次拥有不同 ID。
      const generation=original && original.series===next.id ? (original.generation??0)+1 : 0
      const segment: ScheduleSegment={...recurrenceOptions(rule!),index:0,at:next.remindAt,dueAt:null,remindAt:next.remindAt}
      return {...next,recurrenceRule:storeChecklistRecurrence(rule!,{
        format:'todou-checklist-recurrence/1',series:next.id,generation,index:0,at:next.remindAt,active:true,
        ...(next.completed?{completedAt:nowIso()}:{}),
        ...(original?.plan && original.series===next.id ? {previous:[...(original.previous??[]),{generation:original.generation??0,plan:original.plan}]} : {}),
        plan:{zone:Intl.DateTimeFormat().resolvedOptions().timeZone,segments:[segment],template:{title:next.title,notes:next.notes}}
      })}
    }
    if (!current || !original || !originalRule) return next
    const root=all().find(item=>item.id===original.series)
    const rootMetadata=readChecklistRecurrence(root?.recurrenceRule),plan=rootMetadata?.plan
    if (!root || !rootMetadata || !plan || current.taskId!==root.taskId ||
      current.id!==checklistOccurrenceId(root.id,original.index,original.generation??0) ||
      (original.generation??0)!==(rootMetadata.generation??0)) return next
    const generation=original.generation??0,index=original.index
    const completedAt=next.completed ? original.completedAt??nowIso():undefined
    const changedDate=next.remindAt!==current.remindAt
    const changedRule=Boolean(rule && encodeRecurrenceRule(rule)!==encodeRecurrenceRule(originalRule))
    const stopped=next.recurrenceMode!=='independent' || !rule
    // 单期提醒例外独立于内容例外；后续计划对齐时保留单期改期或清除提醒的选择。
    let metadata: ChecklistRecurrence={...original,completedAt,
      exception:original.exception || changedDate || next.title!==current.title || next.notes!==current.notes,
      timeException:original.timeException || (changedDate && scope==='this')}
    if (stopped && original.active) {
      plan.stop=Math.min(plan.stop??Infinity,index+1)
      plan.stoppedAt=plan.stoppedAt??nowIso()
      const stoppedText=next.recurrenceRule!==current.recurrenceRule && !parseRecurrenceRule(next.recurrenceRule)?next.recurrenceRule:original.stoppedText??originalRule.legacyText??null
      metadata={...metadata,active:false,stoppedText}
      if (index===0) metadata.plan=plan
      else write(root,storeChecklistRecurrence(parseRecurrenceRule(root.recurrenceRule)!,{...rootMetadata,plan}))
      for (const item of seriesEntries(root,generation)) {
        const m=readChecklistRecurrence(item.recurrenceRule)!
        if (m.index<plan.stop) continue
        applyStop(item,plan)
      }
      return {...next,recurrenceRule:storeChecklistRecurrence(originalRule,metadata)}
    }
    if (!original.active) return {...next,recurrenceRule:storeChecklistRecurrence(originalRule,metadata)}
    if ((scope==='future' || (changedDate && next.remindAt!==null)) && (!next.remindAt || !Number.isFinite(Date.parse(next.remindAt)))) throw new Error(t('独立重复需要有效提醒时间；请先停止自动重复'))
    if (changedRule || (changedDate && scope==='future')) {
      const previous=segmentFor(plan,index)
      const nominal=previous.mode==='calendar'?calendarAt(previous,index,plan.zone):original.generatedFor?completionAt(previous,original.generatedFor,plan.zone):original.at
      const at=scope==='future'?futureField(nominal,current.remindAt,next.remindAt,plan.zone):nominal
      const segment: ScheduleSegment={...recurrenceOptions(rule!),index,at:at!,dueAt:null,remindAt:at!}
      plan.segments=[...plan.segments.filter(s=>s.index<index),segment]
      metadata={...metadata,basis:index?basis(segment):undefined,at:at!}
      if(index===0) metadata.plan=plan
      else write(root,storeChecklistRecurrence(parseRecurrenceRule(root.recurrenceRule)!,{...rootMetadata,plan}))
      for(const item of seriesEntries(root,generation)) {
        const local=readChecklistRecurrence(item.recurrenceRule)!
        if(local.index<=index || item.deletedAt || item.completed) continue
        if(changedRule && untouched(item,plan)) retire(item)
        else align(item,segment,plan)
      }
    }
    return {...next,recurrenceRule:storeChecklistRecurrence(rule!,metadata)}
  }
  function stopForTasks(taskIds: Set<string>) {
    const at=nowIso()
    for(const root of all()) {
      const metadata=readChecklistRecurrence(root.recurrenceRule),rule=parseRecurrenceRule(root.recurrenceRule)
      if(!metadata?.plan || metadata.series!==root.id || !rule || !taskIds.has(root.taskId)) continue
      metadata.active=false
      metadata.plan.stop=0
      metadata.plan.stoppedAt=metadata.plan.stoppedAt??at
      metadata.plan.completeAllAt=at
      const stopped=write(root,storeChecklistRecurrence(rule,metadata))
      applyStop(stopped,metadata.plan)
      for(const item of seriesEntries(root,metadata.generation??0)) {
        const m=readChecklistRecurrence(item.recurrenceRule)!
        if(!m.index) continue
        applyStop(item,metadata.plan)
      }
    }
  }
  function generate(now: Date, completionsOnly = false) {
    let count=0
    const series = new Map<string, {
      root: ChecklistItem; metadata: ChecklistRecurrence; plan: ChecklistSeriesPlan
      generations: Map<number, Map<number, ChecklistItem>>
    }>()
    const members = []
    for (const item of all()) {
      const metadata = readChecklistRecurrence(item.recurrenceRule)
      if (!metadata) continue
      members.push({ item, metadata })
      if (metadata.series === item.id && metadata.plan) {
        series.set(item.id, { root: item, metadata, plan: metadata.plan, generations: new Map() })
      }
    }
    for (const { item, metadata } of members) {
      const group = series.get(metadata.series)
      if (!group || !belongsToRoot(item, group.root, metadata)) continue
      const generation = metadata.generation ?? 0
      let entries = group.generations.get(generation)
      if (!entries) group.generations.set(generation, entries = new Map())
      entries.set(metadata.index, item)
    }
    for (const { root, metadata, plan, generations } of series.values()) {
      if (h.getById(root.taskId).deletedAt) continue
      const generation=metadata.generation??0
      for (const previous of metadata.previous??[]) {
        const history = generations.get(previous.generation)
        if (!history) continue
        for (const [index, item] of history) {
          if(index<(previous.plan.stop??Infinity)) continue
          history.set(index, applyStop(item,previous.plan))
        }
      }
      const entries = generations.get(generation) ?? new Map<number, ChecklistItem>()
      // Reconcile before checking active: peers can have predicted slots before a stop arrived.
      for(const [index,item] of entries) {
        const local=readChecklistRecurrence(item.recurrenceRule)!
        if(!index || item.deletedAt) continue
        if(index>=(plan.stop??Infinity)) {
          entries.set(index,applyStop(item,plan))
          continue
        }
        if(item.completed) continue
        const segment=segmentFor(plan,index)
        if(index!==segment.index && encodeRecurrenceRule(parseRecurrenceRule(item.recurrenceRule)!)!==encodeRecurrenceRule(segment)) {
          entries.set(index,untouched(item,plan)?retire(item):align(item,segment,plan))
        } else if(local.basis!==basis(segment)) {
          entries.set(index,align(item,segment,plan))
        }
      }
      if(!metadata.active || root.recurrenceMode!=='independent' || (root.deletedAt && ![...entries.values()].some(item=>!item.deletedAt))) continue
      const add=(index: number,at: string,segment: ScheduleSegment,generatedFor?:string) => {
        if(index>=(plan.stop??Infinity)) return
        const existing=entries.get(index)
        if(existing && !isRetired(existing)) return
        const m: ChecklistRecurrence={format:'todou-checklist-recurrence/1',series:root.id,generation,index,at,active:true,basis:basis(segment),...(generatedFor?{generatedFor}:{})}
        const raw=storeChecklistRecurrence(segment,m)
        if(existing) {
          const restored=write(existing,raw,at)
          db.exec({sql:'UPDATE checklist_items SET deleted_at=NULL WHERE id=$id',bind:{'$id':existing.id}})
          entries.set(index,{...restored,deletedAt:null})
        } else {
          // 同系列、代次和序号得到相同 ID；以根项创建时间初始化，避免离线预测覆盖较新的人工编辑。
          const item: ChecklistItem={...root,...plan.template,id:checklistOccurrenceId(root.id,index,generation),completed:false,remindAt:at,
            recurrenceRule:raw,recurrenceMode:'independent',deletedAt:null,updatedAt:root.createdAt}
          db.exec({sql:`INSERT OR IGNORE INTO checklist_items
            (id,task_id,title,notes,completed,remind_at,recurrence_rule,recurrence_mode,created_at,updated_at)
            VALUES ($id,$task,$title,$notes,0,$remind,$rule,'independent',$created,$created)`,bind:{
              '$id':item.id,'$task':item.taskId,'$title':item.title,'$notes':item.notes,'$remind':item.remindAt,'$rule':raw,'$created':item.createdAt
            }})
          entries.set(index,item)
        }
        count++
      }
      for(const [i,segment] of plan.segments.entries()) {
        if(completionsOnly || segment.mode!=='calendar') continue
        for(const slot of upcomingSlots(segment,plan.segments[i+1]?.index??plan.stop??Infinity,now,plan.zone)) add(slot.index,slot.at,segment)
      }
      for(const [index,item] of entries) {
        if(index>=(plan.stop??Infinity) || item.deletedAt) continue
        const segment=segmentFor(plan,index),local=readChecklistRecurrence(item.recurrenceRule)!
        if(segment.mode!=='completion' || (index!==segment.index && local.basis!==basis(segment))) continue
        let next=index+1
        while(entries.has(next) && segmentFor(plan,next)===segment) {
          const candidate=entries.get(next)!,candidateMetadata=readChecklistRecurrence(candidate.recurrenceRule)!
          if(isRetired(candidate) || candidateMetadata.basis===basis(segment)) break
          next++
        }
        if(next>=(plan.stop??Infinity) || segmentFor(plan,next)!==segment) continue
        const successor=entries.get(next),prior=readChecklistRecurrence(successor?.recurrenceRule)
        const completion=local.completedAt??item.updatedAt
        if(successor && !successor.deletedAt && prior?.generatedFor && untouched(successor,plan) && (!item.completed || prior.generatedFor!==completion)) {
          entries.set(next,retire(successor))
        }
        if(!item.completed) continue
        const at=completionAt(segment,completion,plan.zone)
        if(at) add(next,at,segment,completion)
      }
    }
    return count
  }
  return {prepare,generate,stopForTasks}
}
