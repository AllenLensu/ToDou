import { newId } from '../storage/transform'
import { t } from '../i18n'
import { computed, onBeforeUnmount, reactive, readonly, shallowRef, watch } from 'vue'
import { TaskDraftSession, type DraftSaveState } from '../application/taskDraftSession'
import { fromLocalDateTime, toLocalDateTime } from '../domain/localDateTime'
import { parseRecurrenceRule } from '../domain/recurrence'
import { emptyDraft, type Draft } from '../domain/taskUi'
import type { ReminderSettings, Task, TaskInput } from '../storage/types'

interface DraftSnapshot { draft: Draft; relatedTaskIds: string[] }

export interface PreparedDraftSave {
  input: TaskInput
  relatedTaskIds: string[]
  editBatchId: string
  scope: 'this' | 'future' | undefined
  original: Task | undefined
}

interface TaskDraftOptions {
  /** 新草稿和未单独设置提醒的任务所沿用的全局提醒设置。 */
  defaults: ReminderSettings
  /** 当前打开任务的已保存版本；新建时为 undefined。 */
  saved: () => Task | undefined
  ensureReady: () => void
  onBeforePersist: () => void
  persist: (prepared: PreparedDraftSave) => Promise<void>
  onError: (error: unknown) => void
  onInvalid: (message: string) => void
  /** 回收站详情只读，修改不进入保存会话。 */
  editable: () => boolean
}

/** 详情编辑缓冲：程序回填不记为未保存修改，每次载入已保存任务都开始新的编辑批次。 */
export function useTaskDraft(options: TaskDraftOptions) {
  const draft = reactive<Draft>(emptyDraft())
  const relatedTaskIds = shallowRef<string[]>([])
  const saveState = shallowRef<DraftSaveState>('saved')
  const isSaving = shallowRef(false)
  const rescheduleScope = shallowRef<'this' | 'future' | ''>('')
  const needsRescheduleScope = computed(() => {
    const original = options.saved()
    return Boolean(original && (original.recurrenceSeriesId || parseRecurrenceRule(original.recurrenceRule))
      && (draft.dueAt !== toLocalDateTime(original.dueAt) || draft.remindAt !== toLocalDateTime(original.remindAt)))
  })
  let batchId = newId()
  let loading = false
  let inheritedSettings = JSON.stringify(draft.reminderSettings)

  function toInput(editing: Draft, original: Task | undefined): TaskInput {
    // 存储会添加系列模板；配置未变时原样传回，避免标题等编辑丢失模板元数据。
    let recurrenceRule = editing.recurrenceRule || null
    const previousRule = parseRecurrenceRule(original?.recurrenceRule ?? null)
    const nextRule = parseRecurrenceRule(recurrenceRule)
    if (previousRule && nextRule && JSON.stringify(previousRule) === JSON.stringify(nextRule)) recurrenceRule = original!.recurrenceRule
    return {
      title: editing.title.trim(),
      notes: editing.notes.trim(),
      url: editing.url.trim(),
      priority: editing.priority,
      status: editing.status,
      dueAt: fromLocalDateTime(editing.dueAt, original?.dueAt),
      remindAt: fromLocalDateTime(editing.remindAt, original?.remindAt),
      parentTaskId: editing.parentTaskId || null,
      recurrenceRule,
      recurrenceSeriesId: editing.recurrenceSeriesId.trim() || original?.recurrenceSeriesId || null,
      completionStrategy: editing.completionStrategy || null,
      categoryId: editing.categoryId || null,
      tagIds: editing.tagIds,
      reminderSettings: !original?.reminderSettings && JSON.stringify(editing.reminderSettings) === inheritedSettings
        ? null : { ...editing.reminderSettings },
    }
  }

  async function persistSnapshot(snapshot: DraftSnapshot) {
    options.ensureReady()
    const editing = snapshot.draft
    if (!editing.title.trim()) {
      throw new Error(t('标题不能为空，草稿已保留'))
    }
    options.onBeforePersist()
    const scope = rescheduleScope.value || undefined
    if (needsRescheduleScope.value && !scope) {
      throw new Error(t('请先选择本次改期适用于“仅此次”还是“此次及以后”'))
    }
    const original = options.saved()
    const input = toInput(editing, original)
    await options.persist({
      input,
      relatedTaskIds: snapshot.relatedTaskIds,
      editBatchId: batchId,
      scope,
      original,
    })
    // 保存期间改期未再变化时，已用过的改期范围随保存成功清除。
    if (draft.dueAt === editing.dueAt && draft.remindAt === editing.remindAt) {
      rescheduleScope.value = ''
    }
  }

  // 会话负责防抖、串行保存与脏状态；保存只使用会话捕获的独立快照。
  const session = new TaskDraftSession<DraftSnapshot>({
    read: () => ({ draft: { ...draft, tagIds: [...draft.tagIds], reminderSettings: { ...draft.reminderSettings } }, relatedTaskIds: [...relatedTaskIds.value] }),
    save: persistSnapshot,
    onState: (state) => { saveState.value = state; isSaving.value = state === 'saving' },
    onError: options.onError,
    canSave: () => !needsRescheduleScope.value || Boolean(rescheduleScope.value),
  })
  session.reset(false)

  function quietly(write: () => void) {
    loading = true
    try { write() }
    finally { loading = false }
  }

  function fill(task: Task) {
    rescheduleScope.value = ''
    draft.title = task.title
    draft.notes = task.notes ?? ''
    draft.url = task.url ?? ''
    draft.priority = task.priority
    draft.status = task.status
    draft.dueAt = toLocalDateTime(task.dueAt)
    draft.remindAt = toLocalDateTime(task.remindAt)
    draft.parentTaskId = task.parentTaskId ?? ''
    draft.recurrenceRule = task.recurrenceRule ?? ''
    draft.recurrenceSeriesId = task.recurrenceSeriesId ?? ''
    draft.completionStrategy = task.completionStrategy ?? ''
    draft.categoryId = task.categoryId ?? ''
    draft.tagIds = [...task.tagIds]
    draft.reminderSettings = task.reminderSettings
      ? { ...task.reminderSettings } : { ...options.defaults, followUpMinutes: null }
    inheritedSettings = JSON.stringify(draft.reminderSettings)
  }

  /** 以已保存的任务开始新的编辑批次；省略 related 时保留当前关联。 */
  function load(task: Task, related?: string[]) {
    quietly(() => {
      fill(task)
      if (related) relatedTaskIds.value = related
    })
    batchId = newId()
    session.reset(true)
  }

  /** 已写入存储的改动回填草稿，并作为新的已保存基线。 */
  function acceptSaved(write: () => void) {
    quietly(write)
    batchId = newId()
    session.reset(true)
  }

  function clear() {
    quietly(() => {
      rescheduleScope.value = ''
      Object.assign(draft, emptyDraft(options.defaults))
      inheritedSettings = JSON.stringify(draft.reminderSettings)
      relatedTaskIds.value = []
    })
    batchId = newId()
    session.reset(false)
  }

  function chooseRescheduleScope(scope: 'this' | 'future') {
    rescheduleScope.value = scope
    session.changed()
  }

  async function save() {
    if (needsRescheduleScope.value && !rescheduleScope.value) {
      options.onInvalid(t('请先选择本次改期适用于“仅此次”还是“此次及以后”'))
      return false
    }
    if (!draft.title.trim()) {
      saveState.value = 'failed'
      options.onInvalid(t('标题不能为空，草稿已保留'))
      return false
    }
    return session.flush(true)
  }

  watch(() => [draft.dueAt, draft.remindAt], () => {
    if (!loading) rescheduleScope.value = ''
  }, { flush: 'sync' })

  watch(() => JSON.stringify({ draft, relatedTaskIds: relatedTaskIds.value }), (serialized) => {
    // 回填任务时同步跳过脏标记；直接把当前序列化结果传给会话，避免每次击键重复序列化。
    if (!loading && options.editable()) session.changed(serialized)
  }, { flush: 'sync' })

  onBeforeUnmount(() => session.dispose())

  return {
    draft,
    relatedTaskIds,
    saveState: readonly(saveState),
    isSaving: readonly(isSaving),
    rescheduleScope: readonly(rescheduleScope),
    needsRescheduleScope,
    isDirty: () => session.dirty,
    awaitingReview: () => session.awaitingReview,
    flush: () => session.flush(),
    holdForReview: (existing: boolean) => session.holdForReview(existing),
    load,
    acceptSaved,
    clear,
    quietly,
    chooseRescheduleScope,
    save,
  }
}
