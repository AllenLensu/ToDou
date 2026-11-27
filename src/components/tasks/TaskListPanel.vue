<script setup lang="ts">
import { getLocale, t } from '../../i18n'

import AppIcon from '../ui/AppIcon.vue'
import EmptyStateArtwork from '../ui/EmptyStateArtwork.vue'
// 列表展示及输入事件层；父层提供已排序数据，变高窗口只负责可见行，不改变业务顺序。
import type { Task, TaskStatus } from '../../storage/types'
import type { ChecklistRow } from '../../domain/taskUi'
import { useChecklistEditDrafts } from '../../composables/useChecklistEditDrafts'
import ChecklistItemRow from '../checklists/ChecklistItemRow.vue'
import { taskListFilters, type TaskListFilter } from '../../domain/taskFilters'
import { buildAgenda, countAgendaDays, type AgendaDay } from '../../domain/taskAgenda'
import type { TaskListEntry } from '../../domain/taskHierarchy'
import type { SearchDocument } from '../../domain/taskSearch'
import QuickAddTask from './QuickAddTask.vue'
import { NEW_TASK_ID, WORKSPACE_LIST_ID } from '../../composables/useWorkspaceFocus'
import TaskSearchBox from './TaskSearchBox.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import TaskRow from './TaskRow.vue'
import AgendaCopyButton from './AgendaCopyButton.vue'
import AgendaWeek from './AgendaWeek.vue'
import { computed, inject, nextTick, useTemplateRef } from 'vue'
import { useMeasuredWindow } from '../../composables/useMeasuredWindow'
import { useTaskLayoutMotion } from '../../composables/useTaskLayoutMotion'
import { useTaskRowMotion } from '../../composables/useTaskRowMotion'
import { reminderRuntimeKey } from '../../composables/useReminderDisplay'
import { singleKeyShortcutsEnabled } from '../../application/keyboardShortcutsPreference'

const props = defineProps<{
  /** 父层已筛选并按展示顺序排列的任务；子任务跟随父任务，本组件不重排。 */
  entries: TaskListEntry[]
  listTasks: readonly Task[]
  deletedTasks: readonly Task[]
  visibleChecklistItems: ChecklistRow[]
  listFilter: TaskListFilter
  selectedId: string | null
  showTrash: boolean
  isLoading: boolean
  now: Date
  searchActive: boolean
  conditionsActive?: boolean
  searchTokens: readonly string[]
  searchIndex: ReadonlyMap<string, SearchDocument>
}>()

const emit = defineEmits<{
  'new-task': []
  'select-filter': [filter: TaskListFilter]
  'select-task': [task: Task]
  'open-search-result': [task: Task, target: 'list' | 'detail']
  'set-status': [task: Task, status: TaskStatus]
  'restore-task': [task: Task]
  'permanently-delete-task': [task: Task]
  'remove-task': [task: Task]
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })
const scopeLabel = computed(() => ({ all: t('全部任务（含已完成、已取消）'), today: t('今天'), upcoming: t('即将'), done: t('已完成和已取消') })[props.listFilter])
const checklistHeading = computed(() => props.listFilter === 'today' ? t('检查项 · 今天提醒') : props.listFilter === 'upcoming' ? t('检查项 · 即将提醒') : t('检查项 · 也在总待办中'))

async function openFirstResult(target: 'list' | 'detail') {
  const task = props.entries[0]?.task
  if (task) return emit('open-search-result', task, target)
  const first = props.visibleChecklistItems[0]
  if (!props.searchActive || !first) return
  revealCheck(first.id)
  await nextTick()
  if (props.entries.length || props.visibleChecklistItems[0]?.id !== first.id) return
  const row = checklistHost.value?.querySelector<HTMLElement>('[data-checklist-id]')
  if (row?.dataset.checklistId !== first.id) return
  const edit = row.querySelector<HTMLButtonElement>('.checklist-edit-button')
  if (edit && target === 'detail') edit.click()
  else (edit ?? row.querySelector<HTMLInputElement>('.checklist-item-editor input'))?.focus()
}
const taskHost = useTemplateRef<HTMLElement>('taskHost')
const checklistHost = useTemplateRef<HTMLElement>('checklistHost')
const taskLayout = useTemplateRef<HTMLElement>('taskLayout')
const capturePanel = useTemplateRef<HTMLElement>('capturePanel')
const resultsPanel = useTemplateRef<HTMLElement>('resultsPanel')
useTaskLayoutMotion(taskLayout, capturePanel, resultsPanel)
const checklistEditDrafts = useChecklistEditDrafts()

// 三种列表布局都按这行检查项的实际归属操作，与当前选中的任务无关；操作通过工作区检查项上下文派发。
function checklistRowBindings(item: ChecklistRow) {
  return {
    item,
    'data-checklist-id': item.id,
    taskTitle: item.taskTitle,
    parentStatus: item.parentStatus,
    editDrafts: checklistEditDrafts,
  }
}

// 两类列表分别按数量切换普通／实测变高窗口；筛选或搜索变化重置任务滚动，选中项仍需可聚焦。
// 普通列表与虚拟窗口共用行节点，跨过窗口化阈值时仍能衔接进出动画。
const { enabled: virtualTasks, rows: taskRows, padding: taskPadding, observeRow: measureTask } = useMeasuredWindow({
  items: () => props.entries, key: ({ task }) => task.id, host: taskHost,
  selectedKey: () => props.selectedId, resetKey: () => `${props.showTrash}:${props.listFilter}:${searchQuery.value}`,
})
const { enabled: virtualChecks, rows: checkRows, padding: checkPadding, observeRow: measureCheck, reveal: revealCheck } = useMeasuredWindow({
  items: () => props.visibleChecklistItems, key: (item) => item.id, host: checklistHost,
})

const runtime = inject(reminderRuntimeKey)
const timelineHost = useTemplateRef<HTMLElement>('timelineHost')
const dayFormatter = computed(() => new Intl.DateTimeFormat(getLocale(), { month: 'long', day: 'numeric', weekday: 'short' }))
const agendaScope = computed(() => !props.showTrash && (props.listFilter === 'today' || props.listFilter === 'upcoming'))
const isTimeline = computed(() => agendaScope.value && !props.searchActive)
const agenda = computed(() => {
  const filter = props.listFilter
  if (!agendaScope.value || (filter !== 'today' && filter !== 'upcoming')) return []
  return buildAgenda(props.entries, props.visibleChecklistItems, filter, props.now, runtime?.value ?? {})
    .map(row => ({ ...row, group: row.overdue ? t('已逾期') : dayFormatter.value.format(row.time) }))
})
const agendaDays = computed(() => countAgendaDays(agenda.value, props.now))
const { rows: agendaRows, padding: agendaPadding, observeRow: measureAgenda, reveal: revealAgenda } = useMeasuredWindow({
  items: () => agenda.value, key: row => row.key, host: timelineHost,
  selectedKey: () => props.selectedId && 'task:' + props.selectedId, resetKey: () => props.listFilter,
})
const { enter, leave, leavingRows, moveClass } = useTaskRowMotion(
  () => ({ tasks: props.listTasks, trash: props.deletedTasks, view: props.showTrash ? 'trash' : 'tasks' }),
  () => props.showTrash ? 'trash' : `${props.listFilter}:${isTimeline.value}:${searchQuery.value}`,
  () => props.isLoading,
  [
    { host: taskHost, hasRows: () => props.entries.length > 0 },
    { host: timelineHost, hasRows: () => agenda.value.length > 0 },
  ],
)

async function focusAgendaDay(day: AgendaDay) {
  if (!day.firstKey) return
  revealAgenda(day.firstKey)
  await nextTick()
  const row = timelineHost.value?.querySelector<HTMLElement>(`[data-virtual-key="${CSS.escape(day.firstKey)}"]:not([inert])`)
  if (!row) return
  const target = row.querySelector<HTMLElement>('.task-main-selectable, .checklist-edit-button, .checklist-item-editor input')
  target?.focus({ preventScroll: true })
  row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

const emptyCopy = computed<Record<TaskListFilter, { label: string; text: string }>>(() => ({
  all: { label: t('[NO TASKS]'), text: t('写下标题，点「添加」或按 Enter，其他内容可以以后补。') },
  today: { label: t('[NOTHING TODAY]'), text: t('今天没有到期或提醒的任务，也没有逾期未完成的任务。') },
  upcoming: { label: t('[NOTHING UPCOMING]'), text: t('未来 7 天没有到期或提醒的任务。') },
  done: { label: t('[NOTHING DONE YET]'), text: t('已完成和已取消的任务会出现在这里。') },
}))
const emptyKind = computed<'all' | 'today' | 'upcoming' | 'done' | 'search' | 'trash'>(() =>
  props.showTrash ? 'trash' : props.searchActive || props.conditionsActive ? 'search' : props.listFilter)
const hasResults = computed(() => props.entries.length > 0 || props.visibleChecklistItems.length > 0)
const emptyHeading = computed(() => props.showTrash ? t('[TRASH EMPTY]') : props.searchActive || props.conditionsActive ? t('[NO RESULTS]') : emptyCopy.value[props.listFilter].label)
const emptyDescription = computed(() => props.showTrash
  ? t('已删除的任务可以在这里恢复或永久删除。')
  : props.searchActive
    ? t('在{0}中没有找到“{1}”。', scopeLabel.value, searchQuery.value)
    : props.conditionsActive ? t('当前范围内没有符合筛选条件的事项。') : emptyCopy.value[props.listFilter].text)
</script>

<template>
  <section :id="WORKSPACE_LIST_ID" class="task-column tw:le-820:pb-md tw:[.workspace:not(.workspace-list-only)_&]:le-820:hidden" :class="{ 'with-capture': !showTrash }" :aria-label="showTrash ? t('回收站') : t('任务')" tabindex="-1">
    <div ref="taskLayout" class="task-layout">
      <section v-if="!showTrash" ref="capturePanel" class="capture-panel" aria-labelledby="capture-heading">
        <div class="workspace-section-head">
          <h2 id="capture-heading">{{ t('快速新建') }}</h2>
          <button :id="NEW_TASK_ID" class="detail-create" type="button" @click="emit('new-task')">
            <AppIcon name="new" />{{ t('详细新建') }}
          </button>
        </div>
        <QuickAddTask :now="now" />
        <slot name="templates" />
      </section>

      <div ref="resultsPanel" class="results-panel">
        <template v-if="!showTrash">
          <div class="workspace-section-head results-section-head">
            <h2>{{ t('任务列表') }}</h2>
          </div>
          <TaskSearchBox v-model="searchQuery" :active="searchActive" :result-count="entries.length + visibleChecklistItems.length" :scope-label="scopeLabel" @open-first="openFirstResult" />
          <div class="view-tools">
            <SegmentedControl :model-value="listFilter" class="list-filter" :options="taskListFilters" :label="searchActive ? t('搜索范围') : t('任务视图')" size="compact" spring @update:model-value="emit('select-filter', $event)" />
            <slot name="filters" />
          </div>
        </template>

        <AgendaCopyButton v-if="agendaScope && !isLoading" :key="listFilter" :rows="agenda" />
        <AgendaWeek v-if="isTimeline && listFilter === 'upcoming' && !isLoading" :days="agendaDays" @jump="focusAgendaDay" />
        <p v-if="isLoading" class="empty-state tw:max-w-[34rem] tw:text-muted tw:leading-[1.7] tw:text-body tw:py-2xl tw:px-0" role="status" aria-live="polite"><span class="empty-state-label tw:block tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.08em]">{{ t('[OPENING LOCAL DATABASE]') }}</span></p>
        <template v-else>
          <div v-if="isTimeline" ref="timelineHost" class="task-motion-list" :style="agendaPadding" :role="hasResults ? 'list' : undefined" :aria-label="hasResults ? t('按时间排列的任务与检查项') : undefined">
            <TransitionGroup appear :css="false" :move-class="moveClass()" @enter="enter" @leave="leave">
              <div v-for="{ item: row, index } in agendaRows" :key="row.key" :ref="element => measureAgenda(row.key, element)" class="agenda-row" :data-motion-task-id="'task' in row ? row.task.id : undefined" :data-agenda-index="index" role="presentation">
                <h3 v-if="row.group !== agenda[index - 1]?.group" class="agenda-day">{{ row.group }}</h3>
                <TaskRow v-if="'task' in row" :data-task-id="row.task.id" :task="row.task" :selected-id="selectedId"
                  :show-trash="false" :now="now" role="listitem"
                  @select="emit('select-task', $event)" @set-status="(task, status) => emit('set-status', task, status)" @remove="emit('remove-task', $event)" />
                <ChecklistItemRow v-else v-bind="checklistRowBindings(row.check)" role="listitem" />
              </div>
            </TransitionGroup>
          </div>
          <div v-else ref="taskHost" class="task-list task-motion-list" :class="{ 'virtual-list': virtualTasks }" :style="taskPadding" :role="entries.length ? 'list' : undefined" :aria-label="entries.length ? t('任务列表') : undefined" :data-total-items="entries.length">
            <TransitionGroup :key="showTrash ? 'trash' : 'tasks'" appear :css="false" :move-class="moveClass()" @enter="enter" @leave="leave">
              <div v-for="{ item: entry, index } in taskRows" :key="entry.task.id" :ref="element => measureTask(entry.task.id, virtualTasks ? element : null)" class="measured-row" role="presentation" :data-motion-task-id="entry.task.id" :data-window-index="virtualTasks ? index : undefined">
                <TaskRow
                  :data-task-id="entry.task.id" :task="entry.task" :depth="entry.depth" :selected-id="selectedId"
                  :search-document="searchActive && !showTrash ? searchIndex.get(entry.task.id) : undefined" :search-tokens="searchTokens"
                  :show-trash="showTrash" :now="now"
                  role="listitem" :aria-posinset="virtualTasks ? index + 1 : undefined" :aria-setsize="virtualTasks ? entries.length : undefined"
                  @select="emit('select-task', $event)" @set-status="(task, status) => emit('set-status', task, status)" @restore="emit('restore-task', $event)" @permanently-delete="emit('permanently-delete-task', $event)" @remove="emit('remove-task', $event)"
                />
              </div>
            </TransitionGroup>
          </div>
          <div v-if="!hasResults && !leavingRows" class="empty-state tw:max-w-[34rem] tw:text-muted tw:leading-[1.7] tw:text-body tw:py-2xl tw:px-0">
            <EmptyStateArtwork :kind="emptyKind" />
            <span class="empty-state-label tw:block tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.08em]">{{ emptyHeading }}</span>
            <p class="tw:mt-[12px] tw:max-w-[28rem]">{{ emptyDescription }}</p>
            <button v-if="searchActive && !showTrash" class="button button-quiet touch-target" type="button" @click="searchQuery = ''">{{ t('清除搜索') }}</button>
          </div>
        </template>

        <p v-if="!isLoading && entries.length" class="shortcut-hint tw:flex tw:flex-wrap tw:gap-x-sm tw:gap-y-2xs tw:mt-md tw:text-dim tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.04em] tw:[@media(hover:none)]:hidden" :aria-label="t('快捷键提示')">
          <span v-if="!showTrash && singleKeyShortcutsEnabled"><kbd class="tw:mr-2xs tw:py-0 tw:px-2xs tw:border tw:border-solid tw:border-control-border tw:rounded-[4px] tw:text-muted tw:[font:inherit]">N</kbd> {{ t('新建') }}</span>
          <span><kbd class="tw:mr-2xs tw:py-0 tw:px-2xs tw:border tw:border-solid tw:border-control-border tw:rounded-[4px] tw:text-muted tw:[font:inherit]">↑↓</kbd> {{ t('切换') }}</span>
          <span v-if="!showTrash && singleKeyShortcutsEnabled"><kbd class="tw:mr-2xs tw:py-0 tw:px-2xs tw:border tw:border-solid tw:border-control-border tw:rounded-[4px] tw:text-muted tw:[font:inherit]">X</kbd> {{ t('完成') }}</span>
          <span v-if="!showTrash"><kbd class="tw:mr-2xs tw:py-0 tw:px-2xs tw:border tw:border-solid tw:border-control-border tw:rounded-[4px] tw:text-muted tw:[font:inherit]">DEL</kbd> {{ t('删除') }}</span>
          <span><kbd class="tw:mr-2xs tw:py-0 tw:px-2xs tw:border tw:border-solid tw:border-control-border tw:rounded-[4px] tw:text-muted tw:[font:inherit]">ESC</kbd> {{ t('退出') }}</span>
        </p>

        <div v-if="!isTimeline && visibleChecklistItems.length" class="checklist-list tw:mt-sm" :aria-label="checklistHeading">
          <h3 class="list-subheading tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:pt-lg tw:px-0 tw:pb-[12px]">{{ checklistHeading }}</h3>
          <div ref="checklistHost" class="checklist-rows" :style="checkPadding" role="list" :aria-label="t('检查项列表')" :data-total-items="visibleChecklistItems.length">
          <template v-if="!virtualChecks">
            <ChecklistItemRow v-for="item in visibleChecklistItems" :key="item.id" v-bind="checklistRowBindings(item)" role="listitem" />
          </template>
          <template v-else>
            <div v-for="{ item, index } in checkRows" :key="item.id" :ref="(element) => measureCheck(item.id, element)" class="measured-row" role="presentation" :data-window-index="index">
              <ChecklistItemRow v-bind="checklistRowBindings(item)" role="listitem" :aria-posinset="index + 1" :aria-setsize="visibleChecklistItems.length" />
            </div>
          </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.task-column { min-width: 0; padding-top: var(--space-sm); }
.task-layout { display: grid; align-items: start; gap: var(--space-md); }
.capture-panel, .results-panel { min-width: 0; }
.task-column.with-capture { height: 100%; min-height: 0; }
.with-capture > .task-layout {
  height: 100%;
  grid-template-columns: minmax(0, 1fr);
  /* 展开的批量录入或模板可以自行滚动，并给下方任务列表留出空间。 */
  grid-template-rows: fit-content(50%) minmax(0, 1fr);
}
.with-capture :is(.capture-panel, .results-panel) {
  align-self: stretch;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}
.workspace-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-xs);
  min-height: 44px;
  margin-bottom: var(--space-xs);
}
.workspace-section-head h2 {
  color: var(--text-display);
  font: 500 var(--type-subheading) / 1.3 var(--font-ui);
  letter-spacing: -.025em;
}
.detail-create {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 44px;
  padding: 0 var(--space-2xs);
  border: 0;
  background: transparent;
  color: var(--muted);
  font: var(--type-label) / 1.4 var(--font-ui);
}
.detail-create:hover { color: var(--text-display); text-decoration: underline; text-underline-offset: .2em; }
.view-tools { display: flex; align-items: start; flex-wrap: wrap; gap: var(--space-xs) var(--space-sm); margin-block: var(--space-xs) var(--space-sm); }
@media (width > 1120px) {
  .workspace-list-only:not(:has(> .task-detail-exiting)) .with-capture > .task-layout {
    grid-template-columns: minmax(17rem, .85fr) minmax(0, 1.7fr);
    grid-template-rows: minmax(0, 1fr);
    gap: clamp(2rem, 5vw, 5rem);
  }
}
.agenda-day { margin: 22px 0 6px; font-size: var(--type-label); color: var(--muted); }
.agenda-row { display: flow-root; }
.virtual-list { overflow-anchor: none; }
.checklist-rows { overflow-anchor: none; }
.measured-row { display: flow-root; padding-bottom: 1px; overflow-anchor: none; }
@media (max-width: 820px) {
  .task-column { padding-top: 0; }
  .task-layout { gap: var(--space-xs); }
  .workspace-section-head { min-height: 36px; margin-bottom: var(--space-2xs); }
  /* 窄屏下列表已有搜索框与视图分段条自解释，视觉折叠重复的「任务列表」标题以把首屏空间留给任务行。 */
  .results-section-head {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
}
</style>
