import { notice, t } from '../i18n'
import type { TaskTemplate } from '../domain/taskTemplate'
// 工作区协调层：编排各聚焦能力（草稿会话、检查项、快速录入、提醒、同步、备份与恢复）的跨功能先后顺序，不直接堆叠各子能力的内部实现。
import { computed, onMounted, reactive, shallowRef, watch } from 'vue'
import {
  loadTaskExtras as loadTaskExtrasUseCase,
  loadWorkspace,
  saveTask as saveTaskUseCase,
} from '../application/taskWorkspaceService'
import { downloadLocalDataExport } from '../application/localDataTransfer'
import { createTaskStore } from '../storage/taskStore'
import type {
  Category,
  ChecklistItem,
  Tag,
  Task,
  TaskHistoryEntry,
  HistoryTextField,
  TaskStore,
  TaskStatus,
  ReminderSettings,
} from '../storage/types'
import { filterChecklistItems, filterTasks, isOverdue, scheduledTime, taskCounts, type TaskListFilter } from '../domain/taskFilters'
import { orderByHierarchy } from '../domain/taskHierarchy'
import { useTaskSearch } from './useTaskSearch'
import { useTaskFilterPresets } from './useTaskFilterPresets'
import { useTaskDeleteUndo } from './useTaskDeleteUndo'
import { useSharedRestore } from './useSharedRestore'
import { readSyncScope } from '../sync/providers'
import { useIndependentBackups } from './useIndependentBackups'
import { useDeviceSync } from './useDeviceSync'
import type { FieldChange } from '../sync/fieldMerge'
import { parseRecurrenceRule } from '../domain/recurrence'
import { nextReminderTime, reminderItemsFromRows } from '../application/reminderService'
import { runReminderTimeChange, sameReminderTime } from '../application/reminderReschedule'
import { useReminderRuntime } from './useReminderRuntime'
import { recoverSharedData, type LocalRecoveryResult } from '../storage/recovery'
import { useLocalRecovery } from './useLocalRecovery'
import { useTaskDraft, type PreparedDraftSave } from './useTaskDraft'
import { useWorkspaceClock } from './useWorkspaceClock'
import { useQuickCapture } from './useQuickCapture'
import { useChecklistWorkflow } from './useChecklistWorkflow'
import { useTaxonomyAndTemplates } from './useTaxonomyAndTemplates'
import { statusLabel, type AppView, type ChecklistRow } from '../domain/taskUi'

export type PendingNavigation = (() => void | Promise<void>) | 'review-restored-draft' | null

export function useTaskWorkspace(initialView: AppView = 'tasks', openStore: () => Promise<TaskStore> = createTaskStore) {
  const store = shallowRef<TaskStore | null>(null)
  const templates = shallowRef<TaskTemplate[]>([])
  const tasks = shallowRef<Task[]>([])
  const deletedTasks = shallowRef<Task[]>([])
  const categories = shallowRef<Category[]>([])
  const tags = shallowRef<Tag[]>([])
  const history = shallowRef<TaskHistoryEntry[]>([])
  const checklistItems = shallowRef<ChecklistItem[]>([])
  const allChecklistItems = shallowRef<ChecklistRow[]>([])
  const view = shallowRef<AppView>(initialView)
  const showTrash = computed(() => view.value === 'trash')
  const listFilter = shallowRef<TaskListFilter>('all')
  const selectedId = shallowRef<string | null>(null)
  /** True while the detail panel shows a blank draft that has not been saved yet. */
  const isCreating = shallowRef(false)
  const isLoading = shallowRef(true)
  const isNavigating = shallowRef(false)
  const isMutating = shallowRef(false)
  const recoveryRequired = shallowRef(false)
  const errorMessage = shallowRef('')
  const statusNotice = shallowRef<(() => string) | null>(null)
  const statusMessage = computed(() => statusNotice.value?.() ?? '')
  const pendingNavigation = shallowRef<PendingNavigation>(null)
  let navigationRevision = 0

  const reminderSettings = reactive<ReminderSettings>({
    mode: 'notification', followUpMinutes: 60, strength: 'normal',
    quietHoursEnabled: true, quietStart: '22:00', quietEnd: '08:00', notifyAfterQuietHours: true,
  })

  async function withMutation<T>(action: () => Promise<T>): Promise<T> {
    isMutating.value = true
    try { return await action() }
    finally { isMutating.value = false }
  }

  const canMutate = () => !isMutating.value && !isNavigating.value && !recoveryRequired.value

  const search = useTaskSearch({ tasks, checklistItems: allChecklistItems, categories, tags, listFilter })
  const filterPresets = useTaskFilterPresets({ tasks, categories, tags, scope: listFilter, query: search.query, applyScopeQuery: search.applyScopeQuery })
  const deleteUndo = useTaskDeleteUndo(statusNotice)

  const reminderItems = () => reminderItemsFromRows(tasks.value, allChecklistItems.value, categories.value, reminderSettings)
  const reminders = useReminderRuntime({
    store,
    items: reminderItems,
    settings: reminderSettings,
    busy: () => isMutating.value || isNavigating.value,
    onNotice: (message) => { statusNotice.value = message },
    onStateChange: () => deviceSync.refresh(true),
    onError: reportSaveError,
  })
  const reminderRuntime = reminders.runtime
  const reminderTimeLifecycle = {
    pause: reminders.pause,
    resume: async () => {
      if (!reminders.release()) return
      if (!store.value || store.value.isRecoveryRequired()) return
      await refreshTasks()
      await reminders.start()
    },
  }

  const editor = useTaskDraft({
    defaults: reminderSettings,
    saved: () => tasks.value.find(task => task.id === selectedId.value),
    ensureReady: () => {
      if (!store.value) throw new Error(t('本地数据库尚未就绪，草稿已保留'))
    },
    onBeforePersist: () => {
      errorMessage.value = ''
      statusNotice.value = null
    },
    persist: persistDraft,
    onError: reportSaveError,
    onInvalid: (message) => { errorMessage.value = message },
    editable: () => !showTrash.value,
  })
  const { draft, relatedTaskIds, saveState, isSaving, rescheduleScope, needsRescheduleScope } = editor
  const inheritedFollowUpMinutes = computed(() =>
    categories.value.find(category => category.id === draft.categoryId)?.followUpMinutes ?? reminderSettings.followUpMinutes)

  const recovery = useLocalRecovery({
    replace: replaceLocalData,
    canReplace: (fromShared) => !isSaving.value && !isLoading.value
      && (!fromShared || !(isMutating.value || isNavigating.value || quickCapture.busy.value)),
    commitDraft: async () => !store.value || recoveryRequired.value || editor.flush(),
  })
  const localRecovery = recovery.controls

  // 暂时隐藏不可用的库，使同步不能在初始化、导入或恢复期间进入旧库。
  const syncStore = computed(() => isLoading.value || recovery.isBusy.value || recoveryRequired.value ? null : store.value)
  const deviceSync = useDeviceSync(syncStore, applySyncedChanges)
  const sharedRestore = useSharedRestore(syncStore, () => deviceSync.scope, async (data, binding, assertUnchanged) => {
    const checkDirectory = async () => {
      if (await readSyncScope() !== binding.scope) throw new Error(t('网盘目录已改变，本机仍保留原清单。'))
    }
    await checkDirectory()
    return recovery.restore(() => recoverSharedData(data, binding, checkDirectory), assertUnchanged)
  })
  const backups = useIndependentBackups(async manual => {
    const current = syncStore.value
    if (!current) throw new Error(t('请等待本机数据准备就绪。'))
    if (manual && !await editor.flush()) throw new Error(t('请先保存当前编辑再备份。'))
    if (current !== syncStore.value) throw new Error(t('本机数据已切换，请重新备份。'))
    return current.exportLocalData()
  }, () => Boolean(syncStore.value))

  const clock = useWorkspaceClock({
    canResume: () => !recoveryRequired.value && !isLoading.value && !recovery.isBusy.value && Boolean(store.value),
    onResume: async () => {
      await refreshTasks()
      if (selectedId.value) await loadTaskExtras(selectedId.value)
    },
    onError: reportSaveError,
    hasUnsavedWork: () => editor.isDirty() || isSaving.value || hasCaptureDraft(),
  })
  const now = clock.now

  const checklists = useChecklistWorkflow({
    store,
    selectedId,
    tasks,
    allChecklistItems,
    categories,
    reminderSettings,
    reminderRuntime,
    now,
    canMutate,
    withMutation,
    reminderLifecycle: reminderTimeLifecycle,
    onRefreshAfterWrite: async (ownerId) => {
      await refreshTasks()
      if (ownerId) await loadTaskExtras(ownerId)
    },
    onNotice: (message) => { statusNotice.value = message },
    onClearError: () => { errorMessage.value = '' },
    onError: reportSaveError,
  })

  const quickCapture = useQuickCapture({
    store,
    canSubmit: canMutate,
    reminderSettings,
    now,
    onRefresh: refreshTasks,
    onNotice: (message) => { statusNotice.value = message },
    onClearError: () => { errorMessage.value = '' },
    onError: reportSaveError,
  })

  const taxonomy = useTaxonomyAndTemplates({
    store,
    selectedId,
    tasks,
    categories,
    tags,
    templates,
    reminderSettings,
    canMutate,
    withMutation,
    flushDraft: editor.flush,
    onTagAddedToDraft: (tagId) => {
      if (!draft.tagIds.includes(tagId)) draft.tagIds.push(tagId)
    },
    onTagRemovedFromDraft: (tagId) => {
      editor.quietly(() => { draft.tagIds = draft.tagIds.filter(member => member !== tagId) })
    },
    reminderLifecycle: reminderTimeLifecycle,
    onRefreshTasks: refreshTasks,
    onNotice: (message) => { statusNotice.value = message },
    onError: reportSaveError,
  })

  function hasCaptureDraft() {
    return quickCapture.hasDraft() || checklists.hasAnyDraft()
  }

  async function applySyncedChanges(apply: () => Promise<void>, hasIncoming: boolean) {
    if (recovery.isBusy.value || recoveryRequired.value || !store.value) {
      throw new Error(t('本地数据正在恢复，稍后可重新同步。'))
    }
    if (!hasIncoming) return apply()
    if (isNavigating.value || isMutating.value) throw new Error(t('本地数据正在更改，稍后可重新同步。'))
    const activeStore = store.value
    isMutating.value = true
    let stopped = false
    try {
      // 新建未保存任务没有远端对应项，保留编辑器；已有任务则先提交草稿再应用远端值。
      if (selectedId.value && !await editor.flush()) throw new Error(t('请先保存当前任务，再同步其他设备的改动。'))
      await reminders.pause()
      stopped = true
      await apply()
      await refreshTasks()
      if (selectedId.value) {
        const selected = (showTrash.value ? deletedTasks.value : tasks.value).find(item => item.id === selectedId.value)
        if (selected) {
          const extras = await loadTaskExtrasUseCase(activeStore, selected.id)
          history.value = extras.history
          checklistItems.value = extras.checklistItems
          editor.load(selected, extras.relatedTaskIds)
        } else clearDraft()
      }
      reminders.dropSnoozed(await activeStore.getReminderRuntimeState())
    } finally {
      try {
        if (stopped) {
          reminders.release()
          if (store.value === activeStore) await reminders.start()
        }
      } finally {
        isMutating.value = false
      }
    }
  }

  // 本地写入后的列表刷新、草稿落盘和提醒推迟均更新日常页计数；一分钟模式下合并触发待传改动。
  watch([view, tasks, deletedTasks, categories, tags, taxonomy.defaultCompletionStrategy, allChecklistItems, saveState, taxonomy.uiTheme], () => {
    void deviceSync.refresh(true)
  })

  function syncItemLabel(change: FieldChange): string {
    if (change.collection === 'tasks') return [...tasks.value, ...deletedTasks.value].find(task => task.id === change.id)?.title ?? change.id
    if (change.collection === 'checklistItems') return allChecklistItems.value.find(item => item.id === change.id)?.title ?? change.id
    if (change.collection === 'tags') return tags.value.find(tag => tag.id === change.id)?.name ?? change.id
    if (change.collection === 'categories') return categories.value.find(category => category.id === change.id)?.name ?? change.id
    return change.id
  }

  function reportSaveError(error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : t('保存失败，草稿已保留')
    const wasRecovering = recoveryRequired.value
    recoveryRequired.value = store.value?.isRecoveryRequired() ?? false
    if (recoveryRequired.value) {
      reminders.halt()
      if (!wasRecovering) void recovery.loadCopies()
    }
  }

  /** 替换本机数据库：暂停同步和提醒、关闭旧库、恢复并重新打开，再决定草稿的去留。 */
  async function replaceLocalData(action: () => Promise<LocalRecoveryResult>, assertUnchanged?: () => void) {
    isMutating.value = true
    const keepDraft = editor.isDirty()
    const wasSyncEnabled = deviceSync.enabled
    let restartReminders = false
    function holdEdits() {
      if (wasSyncEnabled || deviceSync.enabled) deviceSync.pause()
      editor.holdForReview(Boolean(selectedId.value))
    }
    try {
      if (assertUnchanged) {
        assertUnchanged()
        restartReminders = true
      } else holdEdits()
      await reminders.suspend()
      // 存储读取会等待先前的写队列，避免副本遗漏已经排队的保存。
      if (store.value && !store.value.isRecoveryRequired()) await store.value.listTags()
      if (assertUnchanged) {
        assertUnchanged()
        holdEdits()
      }
      restartReminders = false
      store.value?.close()
      store.value = null
      const result = await action()
      if (!await initializeWorkspace()) throw new Error(t('文件已恢复，但仍无法打开。请保留原文件副本后重试。'))
      if (keepDraft) {
        // 恢复后不自动把旧草稿写入新库；原任务已不存在时保留为新建草稿，等待显式保存或放弃。
        if (selectedId.value && !tasks.value.some((task) => task.id === selectedId.value)) {
          selectedId.value = null
          isCreating.value = true
          history.value = []
          checklistItems.value = []
        }
        if (selectedId.value) await loadTaskExtras(selectedId.value)
        editor.holdForReview(Boolean(selectedId.value))
        pendingNavigation.value = 'review-restored-draft'
      } else clearDraft()
      const recovered = result.preservedCopy ? notice('[已恢复本地数据] 原文件已保留为 {0}', result.preservedCopy) : notice('[已恢复本地数据]')
      statusNotice.value = keepDraft ? () => recovered() + t('。草稿已保留，请检查后点击“立即保存”或按 Ctrl+S。') : recovered
    } catch (error) {
      if (!store.value) await initializeWorkspace()
      throw error
    } finally {
      isMutating.value = false
      if (restartReminders && store.value) await reminders.start()
    }
  }

  async function navigate(action: () => void | Promise<void>, fromShortcut = false) {
    if (isNavigating.value || isMutating.value) return
    // flush 会排空已有任务保存期间的新输入，但不创建未保存的新任务；失败则保留草稿和待执行动作。
    // 等待保存时允许新的导航意图或“继续编辑”使本次失效，只有最新意图能继续。
    const revision = ++navigationRevision
    const ok = await editor.flush()
    if (revision !== navigationRevision) return
    if (!ok || (fromShortcut ? hasCaptureDraft() : checklists.hasNewChecklistDraft())) {
      pendingNavigation.value = fromShortcut ? () => {
        quickCapture.discard()
        checklists.discardRowEdits()
        return action()
      } : action
      if (!ok && !selectedId.value) errorMessage.value = t('新任务尚未创建，请继续编辑或放弃未保存修改')
      return
    }
    pendingNavigation.value = null
    isNavigating.value = true
    try { await action() } catch (error) { reportSaveError(error) }
    finally { if (revision === navigationRevision) isNavigating.value = false }
  }

  function continueEditing() { pendingNavigation.value = null; ++navigationRevision }

  async function discardChanges() {
    const action = pendingNavigation.value
    pendingNavigation.value = null
    clearDraft()
    if (typeof action === 'function') {
      isNavigating.value = true
      try { await action() } catch (error) { reportSaveError(error) }
      finally { isNavigating.value = false }
    }
  }

  async function changeView(next: AppView) {
    if (next === view.value) return
    await navigate(() => { clearDraft(); view.value = next })
  }

  async function changeListFilter(next: TaskListFilter) {
    if (next === listFilter.value) return
    // 搜索中的范围切换只改变结果集，不离开编辑器，也不覆盖搜索会话记住的原范围。
    if (search.active.value || filterPresets.active.value || filterPresets.panelOpen.value) { listFilter.value = next; return }
    await navigate(() => { clearDraft(); listFilter.value = next })
  }

  const visibleTasks = computed(() => {
    if (showTrash.value) return deletedTasks.value
    const scoped = filterTasks(tasks.value, listFilter.value, now.value, reminderRuntime.value)
    const owners = filterPresets.ownerIds.value
    return owners ? scoped.filter(task => owners.has(task.id)) : scoped
  })
  const orderedEntries = computed(() => orderByHierarchy(showTrash.value ? deletedTasks.value : tasks.value))
  const visibleEntries = computed(() => {
    if (showTrash.value) return orderedEntries.value
    const filter = listFilter.value
    if (!search.active.value && (filter === 'today' || filter === 'upcoming')) {
      const entries = visibleTasks.value.map(task => ({ task, depth: 0,
        overdue: filter === 'today' && isOverdue(task, now.value),
        time: scheduledTime(task, filter, now.value, reminderRuntime.value)! }))
      return entries.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.time - b.time || a.task.id.localeCompare(b.task.id))
    }
    if (!search.active.value && !filterPresets.ownerIds.value) return orderByHierarchy(visibleTasks.value)
    const scope = new Set(visibleTasks.value.map((task) => task.id))
    return orderedEntries.value.filter(({ task }) => scope.has(task.id) && (!search.active.value || search.ids.value.has(task.id)))
  })
  const visibleChecklistItems = computed(() => {
    if (showTrash.value || (search.active.value && !filterPresets.active.value)) return []
    const scoped = filterChecklistItems(allChecklistItems.value, tasks.value, listFilter.value, now.value, reminderRuntime.value)
    const owners = filterPresets.ownerIds.value
    if (!owners && !search.active.value) return scoped
    return scoped.filter(item => (!owners || owners.has(item.taskId)) && (!search.active.value || search.ids.value.has(item.taskId)))
  })
  const activeTasks = computed(() => tasks.value.filter((task) => task.deletedAt === null))
  const availableRelatedTasks = computed(() => activeTasks.value.filter((task) => task.id !== selectedId.value))
  const headerCounts = computed(() => taskCounts(tasks.value, now.value, reminderRuntime.value))
  const nextReminder = computed(() => nextReminderTime(reminderItems(), reminderRuntime.value, reminderSettings, now.value))
  const isDatabaseReady = computed(() => Boolean(store.value))
  const detailMode = computed<'empty' | 'create' | 'edit'>(() => selectedId.value ? 'edit' : isCreating.value ? 'create' : 'empty')
  const selectedTask = computed(() => (showTrash.value ? deletedTasks.value : tasks.value).find(t => t.id === selectedId.value))

  /** Close the detail panel (cancel / after delete) and clear the draft. */
  function clearDraft() {
    selectedId.value = null
    isCreating.value = false
    statusNotice.value = null
    history.value = []
    checklistItems.value = []
    checklists.resetChecklistDraft()
    editor.clear()
  }

  async function resetDraft() { await navigate(clearDraft) }

  async function startNewTask() {
    await navigate(() => { clearDraft(); view.value = 'tasks'; isCreating.value = true })
  }

  async function openShortcut(target: 'today' | 'new-task') {
    await navigate(() => {
      clearDraft()
      view.value = 'tasks'
      if (target === 'new-task') isCreating.value = true
      else {
        search.setQuery('')
        listFilter.value = 'today'
      }
    }, true)
  }

  async function selectTask(task: Task) {
    if (selectedId.value === task.id) return
    await navigate(async function openTask() {
      if (!store.value) return
      const request = navigationRevision
      const extras = await loadTaskExtrasUseCase(store.value, task.id)
      // 慢查询不能把用户已离开的任务重新填回详情。
      if (request !== navigationRevision) return
      if (checklists.hasNewChecklistDraft()) {
        pendingNavigation.value = openTask
        return
      }
      const current = [...tasks.value, ...deletedTasks.value].find((item) => item.id === task.id) ?? task
      selectedId.value = current.id
      isCreating.value = false
      history.value = extras.history
      checklistItems.value = extras.checklistItems
      editor.load(current, extras.relatedTaskIds)
      statusNotice.value = null
    })
  }

  async function refreshTasks() {
    if (!store.value) return
    templates.value = await store.value.listTemplates()
    const snapshot = await loadWorkspace(store.value)
    Object.assign(reminderSettings, await store.value.getReminderSettings())
    tasks.value = snapshot.tasks
    deletedTasks.value = snapshot.deletedTasks
    categories.value = snapshot.categories
    tags.value = snapshot.tags
    taxonomy.setDefaultStrategyFromSnapshot(snapshot.defaultCompletionStrategy)
    allChecklistItems.value = snapshot.allChecklistItems
    await reminders.refreshItems()
  }

  async function loadTaskExtras(taskId: string) {
    if (!store.value) return
    const extras = await loadTaskExtrasUseCase(store.value, taskId)
    if (selectedId.value !== taskId) return
    history.value = extras.history
    checklistItems.value = extras.checklistItems
  }

  async function persistDraft(prepared: PreparedDraftSave) {
    const activeStore = store.value!
    const taskId = selectedId.value
    const { input, relatedTaskIds: nextRelatedIds, editBatchId, scope, original } = prepared
    // 周期改期可能移动跟随检查项及后续成员的提醒，即使本任务自己没有提醒。
    const repeating = parseRecurrenceRule(original?.recurrenceRule ?? null) || parseRecurrenceRule(input.recurrenceRule ?? null)
    const refreshRelatedReminders = Boolean(original && (repeating || original.recurrenceSeriesId)
      && (!sameReminderTime(original.dueAt, input.dueAt ?? null) || original.recurrenceRule !== input.recurrenceRule))
    await runReminderTimeChange(original ? original.remindAt : input.remindAt ?? null, input.remindAt ?? null, async () => {
      const result = await saveTaskUseCase(activeStore, {
        selectedId: taskId,
        input,
        relatedTaskIds: nextRelatedIds,
        editBatchId,
        scope,
      })
      selectedId.value = result.task.id
      isCreating.value = false
      await refreshTasks()
      await loadTaskExtras(result.task.id)
    }, reminderTimeLifecycle, refreshRelatedReminders)
  }

  async function saveTask() {
    const revision = navigationRevision
    const saved = await editor.save()
    if (saved && revision === navigationRevision && pendingNavigation.value === 'review-restored-draft') {
      pendingNavigation.value = null
    }
    return saved
  }

  function chooseRescheduleScope(scope: 'this' | 'future') {
    errorMessage.value = ''
    editor.chooseRescheduleScope(scope)
  }

  async function requestNotifications() {
    try {
      const permission = await reminders.requestPermission()
      if (permission === 'granted') { statusNotice.value = notice('[已开启系统提醒]'); errorMessage.value = '' }
      else if (permission === 'denied') errorMessage.value = t('浏览器已拒绝通知权限，请在站点设置中重新开启')
      else if (permission === 'unsupported') errorMessage.value = t('当前环境不支持系统通知')
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    }
  }

  async function completeReminder() {
    await reminders.act(async (event) => {
      if (!store.value) return false
      if (event.item.kind === 'task' && selectedId.value === event.item.id && !await editor.flush()) return false
      return withMutation(async () => {
        if (event.item.kind === 'task') {
          await store.value!.updateTask(event.item.id, { status: 'completed' })
        } else {
          await store.value!.updateChecklistItem(event.item.id, { completed: true })
        }
        await refreshTasks()
        if (selectedId.value) {
          if (event.item.kind === 'task' && selectedId.value === event.item.id) {
            const current = tasks.value.find((task) => task.id === selectedId.value)
            if (current) editor.load(current)
          }
          await loadTaskExtras(selectedId.value)
        }
        statusNotice.value = notice('[已完成] {0}', event.item.title)
        return true
      })
    })
  }

  async function exportLocalData() {
    if (!store.value) return
    if (!await editor.flush()) return
    try {
      downloadLocalDataExport(await store.value.exportLocalData())
      statusNotice.value = notice('[已导出本地数据]')
    } catch (error) {
      reportSaveError(error)
    }
  }

  async function setStatus(task: Task, status: TaskStatus) {
    if (!store.value || isMutating.value || isNavigating.value) return
    if (selectedId.value === task.id && !await editor.flush()) return
    await withMutation(async () => {
      try {
        await store.value!.updateTask(task.id, { status })
        await refreshTasks()
        if (selectedId.value === task.id) {
          editor.acceptSaved(() => { draft.status = status })
          await loadTaskExtras(task.id)
        }
        statusNotice.value = () => `[${statusLabel(status)}]`
      } catch (error) {
        reportSaveError(error)
      }
    })
  }

  async function createOccurrence() {
    if (!store.value || !selectedId.value) return
    if (!await editor.flush()) return
    try {
      const created = await store.value.createTaskOccurrence(selectedId.value)
      await refreshTasks()
      await selectTask(created)
      statusNotice.value = notice('[已创建新的重复期次]')
    } catch (error) {
      reportSaveError(error)
    }
  }

  async function removeTask(task: Task) {
    if (!store.value || isMutating.value || isNavigating.value) return
    if (selectedId.value === task.id && !await editor.flush()) return
    await withMutation(async () => {
      try {
        await store.value!.deleteTask(task.id)
        const reselect = selectedId.value === task.id
        if (reselect) clearDraft()
        await refreshTasks()
        deleteUndo.offer(task, reselect)
      } catch (error) {
        reportSaveError(error)
      }
    })
  }

  async function undoRemove() {
    if (isMutating.value) return
    const undo = deleteUndo.take()
    if (!store.value || !undo) return
    try {
      await store.value.restoreTask(undo.taskId)
      await refreshTasks()
      const restored = tasks.value.find((task) => task.id === undo.taskId)
      if (restored && undo.reselect) void selectTask(restored)
      statusNotice.value = notice('[已撤销删除] {0}', restored?.title ?? '')
    } catch (error) {
      reportSaveError(error)
    }
  }

  async function restoreTask(task: Task) {
    if (!store.value || isMutating.value || isNavigating.value) return
    await withMutation(async () => {
      try {
        await store.value!.restoreTask(task.id)
        await refreshTasks()
        statusNotice.value = notice('[已恢复]')
      } catch (error) {
        reportSaveError(error)
      }
    })
  }

  async function permanentlyDeleteTask(task: Task) {
    if (!showTrash.value || !syncStore.value || isMutating.value || isNavigating.value) return
    await withMutation(async () => {
      try {
        await syncStore.value!.permanentlyDeleteTask(task.id)
        if (selectedId.value === task.id) clearDraft()
        await refreshTasks()
        errorMessage.value = ''
        statusNotice.value = notice('[已永久删除] {0}', task.title)
      } catch (error) {
        reportSaveError(error)
      }
    })
  }

  async function restoreHistory(entry: TaskHistoryEntry, field?: HistoryTextField) {
    const activeStore = syncStore.value
    const taskId = entry.taskId
    if (!activeStore || selectedId.value !== taskId || !canMutate() || !entry.snapshot) return
    ++navigationRevision
    await withMutation(async () => {
      try {
        if (needsRescheduleScope.value && !rescheduleScope.value) {
          errorMessage.value = t('请先选择本次改期适用于“仅此次”还是“此次及以后”')
          return
        }
        if (!await editor.flush() || selectedId.value !== taskId || syncStore.value !== activeStore) return
        const current = [...tasks.value, ...deletedTasks.value].find((task) => task.id === taskId)
        const currentTime = current?.remindAt ?? null
        const nextTime = field === undefined ? entry.snapshot!.remindAt : currentTime
        await runReminderTimeChange(currentTime, nextTime, async () => {
          await activeStore.restoreHistory(taskId, entry.id, field)
          await refreshTasks()
          if (selectedId.value !== taskId || syncStore.value !== activeStore) return
          const restored = tasks.value.find((task) => task.id === taskId)
          if (restored) editor.load(restored)
          await loadTaskExtras(taskId)
          errorMessage.value = ''
          statusNotice.value = field === undefined ? notice('[已恢复历史版本]') : notice('[已取回字段]')
        }, reminderTimeLifecycle)
      } catch (error) {
        reportSaveError(error)
      }
    })
  }

  async function initializeWorkspace() {
    isLoading.value = true
    errorMessage.value = ''
    statusNotice.value = null
    await reminders.suspend()
    reminders.clearQueue()
    if (store.value) {
      store.value.close()
      store.value = null
    }
    try {
      const activeStore = await openStore()
      store.value = activeStore
      recoveryRequired.value = false
      recovery.clearError()
      await refreshTasks()
      Object.assign(reminderSettings, await store.value.getReminderSettings())
      taxonomy.applyLoadedTheme(await store.value.getUiTheme())
      await reminders.loadPermission()
      await reminders.start()
      return true
    } catch (error) {
      reportSaveError(error)
      store.value?.close()
      store.value = null
      await recovery.loadCopies()
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function retryInitialization() {
    if (isLoading.value || isSaving.value || isMutating.value || recovery.isBusy.value) return false
    return initializeWorkspace()
  }

  onMounted(() => { void initializeWorkspace() })

  return {
    deviceSync,
    syncItemLabel,
    tasks,
    deletedTasks,
    categories,
    tags,
    history,
    checklistItems,
    allChecklistItems,
    relatedTaskIds,
    view,
    changeView,
    changeListFilter,
    searchQuery: search.query,
    searchTokens: search.tokens,
    searchActive: search.active,
    searchIndex: search.index,
    setSearchQuery: (value: string) => search.setQuery(value, filterPresets.active.value || filterPresets.panelOpen.value),
    filterPresets,
    saveState,
    rescheduleScope,
    needsRescheduleScope,
    chooseRescheduleScope,
    recoveryRequired,
    isNavigating,
    isMutating,
    pendingNavigation,
    continueEditing,
    discardChanges,
    showTrash,
    listFilter,
    now,
    quickCapture,
    quickAddTitle: quickCapture.title,
    quickAddReminder: quickCapture.reminder,
    quickAddBusy: quickCapture.busy,
    quickAddTask: quickCapture.submit,
    defaultCompletionStrategy: taxonomy.defaultCompletionStrategy,
    selectedId,
    isLoading,
    isDatabaseReady,
    isSaving,
    errorMessage,
    statusMessage,
    reminderSettings,
    inheritedFollowUpMinutes,
    updateDefaultFollowUpMinutes: taxonomy.updateDefaultFollowUpMinutes,
    updateCategoryFollowUpMinutes: taxonomy.updateCategoryFollowUpMinutes,
    uiTheme: taxonomy.uiTheme,
    saveUiTheme: taxonomy.saveUiTheme,
    notificationPermission: reminders.permission,
    activeReminder: reminders.active,
    reminderQueue: reminders.queue,
    reminderActionBusy: reminders.actionBusy,
    notificationError: reminders.notificationError,
    completeReminder,
    localRecovery,
    draft,
    checklistDraft: checklists.checklistDraft,
    hasUnsavedDrafts: hasCaptureDraft,
    visibleTasks,
    previewQuickReminder: quickCapture.previewQuickReminder,
    previewChecklist: checklists.previewChecklist,
    reminderRuntime,
    visibleEntries,
    templates,
    saveTemplate: taxonomy.saveTemplate,
    applyTemplate: taxonomy.applyTemplate,
    deleteTemplate: taxonomy.deleteTemplate,
    visibleChecklistItems,
    activeTasks,
    selectedTask,
    availableRelatedTasks,
    headerCounts,
    nextReminder,
    tagLabel: taxonomy.tagLabel,
    resetDraft,
    startNewTask,
    openShortcut,
    detailMode,
    selectTask,
    saveTask,
    setStatus,
    addChecklistItem: checklists.addChecklistItem,
    createOccurrence,
    toggleChecklist: checklists.toggleChecklist,
    saveChecklistItem: checklists.saveChecklistItem,
    removeChecklist: checklists.removeChecklist,
    removeTask,
    undoRemove,
    undoAvailable: deleteUndo.available,
    restoreTask,
    permanentlyDeleteTask,
    restoreHistory,
    addCategory: taxonomy.addCategory,
    updateDefaultCompletionStrategy: taxonomy.updateDefaultCompletionStrategy,
    addTag: taxonomy.addTag,
    requestNotifications,
    snoozeReminder: reminders.snooze,
    snoozeReminderUntil: reminders.snoozeUntil,
    dismissReminder: reminders.dismiss,
    backups,
    sharedRestore,
    editCategory: taxonomy.editCategory,
    editTag: taxonomy.editTag,
    exportLocalData,
    retryInitialization,
  }
}
