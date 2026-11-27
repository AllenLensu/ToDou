<script setup lang="ts">
import { t } from './i18n'

// 根组件只装配顶层布局、作用域上下文与跨栏焦点协议；草稿提交、持久化与同步由工作区协调。
import AppHeader from './components/app/AppHeader.vue'
import AppNav from './components/app/AppNav.vue'
import DraftLeaveGuard from './components/app/DraftLeaveGuard.vue'
import ChecklistPanel from './components/checklists/ChecklistPanel.vue'
import HistoryPanel from './components/tasks/HistoryPanel.vue'
import StatusBanner from './components/app/StatusBanner.vue'
import SyncErrorToast from './components/sync/SyncErrorToast.vue'
import TaskDetailPanel from './components/tasks/TaskDetailPanel.vue'
import TaskTemplates from './components/tasks/TaskTemplates.vue'
import TaskEditorForm from './components/tasks/TaskEditorForm.vue'
import TaskListPanel from './components/tasks/TaskListPanel.vue'
import TaskFilterPanel from './components/tasks/TaskFilterPanel.vue'
import AuthorizationReturnLoading from './components/sync/AuthorizationReturnLoading.vue'
import SettingsView from './components/app/SettingsView.vue'
import CategorySettings from './components/app/CategorySettings.vue'
import SettingsDataPanel from './components/recovery/SettingsDataPanel.vue'
import ReminderToast from './components/reminders/ReminderToast.vue'
import LocalRecoveryPanel from './components/recovery/LocalRecoveryPanel.vue'
import { useAutoHideScrollbars } from './composables/useAutoHideScrollbars'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useDeviceConnection } from './composables/useDeviceConnection'
import { usePwaShortcutHash } from './composables/usePwaShortcutHash'
import { useTaskWorkspace } from './composables/useTaskWorkspace'
import {
  provideChecklistActions,
  provideCloudSync,
  provideNotificationPermission,
  provideQuickCapture,
  provideTaxonomyLookup,
} from './composables/workspaceContexts'
import { authorizationReturnPhase } from './sync/authorizationReturnLoading'
import { focusVisible, focusWorkspaceList, useWorkspaceFocus } from './composables/useWorkspaceFocus'
import type { Task } from './storage/types'
import { computed, nextTick, provide, shallowRef } from 'vue'
import { checklistPreviewKey, quickReminderPreviewKey, reminderRuntimeKey, useReminderQueuePosition } from './composables/useReminderDisplay'

const props = defineProps<{ returnedFromLogin?: boolean }>()
const {
  deviceSync,
  syncItemLabel,
  tasks,
  deletedTasks,
  categories,
  tags,
  history,
  checklistItems,
  relatedTaskIds,
  view,
  changeView,
  changeListFilter,
  filterPresets,
  searchQuery,
  searchTokens,
  searchActive,
  searchIndex,
  setSearchQuery,
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
  quickAddBusy,
  defaultCompletionStrategy,
  selectedId,
  isLoading,
  isDatabaseReady,
  isSaving,
  errorMessage,
  statusMessage,
  uiTheme,
  saveUiTheme,
  notificationPermission,
  reminderSettings,
  inheritedFollowUpMinutes,
  activeReminder,
  reminderQueue,
  reminderActionBusy,
  notificationError,
  completeReminder,
  localRecovery,
  draft,
  hasUnsavedDrafts,
  visibleEntries,
  reminderRuntime,
  previewQuickReminder,
  previewChecklist,
  templates,
  saveTemplate,
  applyTemplate,
  deleteTemplate,
  visibleChecklistItems,
  selectedTask,
  availableRelatedTasks,
  headerCounts,
  nextReminder,
  resetDraft,
  startNewTask,
  openShortcut,
  detailMode,
  selectTask,
  saveTask,
  setStatus,
  addChecklistItem,
  createOccurrence,
  toggleChecklist,
  saveChecklistItem,
  removeChecklist,
  removeTask,
  undoRemove,
  undoAvailable,
  restoreTask,
  permanentlyDeleteTask,
  restoreHistory,
  addCategory,
  updateDefaultCompletionStrategy,
  updateDefaultFollowUpMinutes,
  updateCategoryFollowUpMinutes,
  addTag,
  requestNotifications,
  snoozeReminder,
  snoozeReminderUntil,
  dismissReminder,
  backups,
  sharedRestore,
  editCategory,
  editTag,
  exportLocalData,
  retryInitialization,
} = useTaskWorkspace(props.returnedFromLogin ? 'settings' : 'tasks')

const reminderPosition = useReminderQueuePosition(reminderQueue)
provide(reminderRuntimeKey, reminderRuntime)
provide(checklistPreviewKey, previewChecklist)
provide(quickReminderPreviewKey, previewQuickReminder)
provideNotificationPermission(notificationPermission, requestNotifications)
provideTaxonomyLookup(tags, categories)
provideQuickCapture(quickCapture, isDatabaseReady)
provideChecklistActions({
  addItem: addChecklistItem,
  saveItem: saveChecklistItem,
  toggleItem: toggleChecklist,
  removeItem: removeChecklist,
})
provideCloudSync({
  sync: deviceSync,
  sharedRestore,
  syncItemLabel,
})

usePwaShortcutHash({
  ready: () => isDatabaseReady.value && !isLoading.value && !isNavigating.value && !isMutating.value && !quickAddBusy.value && !recoveryRequired.value,
  onShortcut: openShortcut,
})

const openSyncSettings = shallowRef(false)
function openView(next: typeof view.value, cloud = false) {
  openSyncSettings.value = cloud
  return changeView(next)
}

const { busy: connectionBusy, failed: connectionFailed, message: connectionMessage, returnedToOneDrive } = useDeviceConnection()
const connectionPanelVisible = computed(() => view.value === 'settings' && isDatabaseReady.value && !recoveryRequired.value)
const returnPhase = computed(() => (connectionPanelVisible.value || view.value !== 'settings')
  ? 'idle'
  : authorizationReturnPhase(returnedToOneDrive.value, connectionBusy.value, connectionMessage.value))
const canRetryDatabase = computed(() => (!isDatabaseReady.value || recoveryRequired.value) && !isLoading.value)
const templatesBusy = computed(() => isMutating.value || isNavigating.value || !isDatabaseReady.value)
const editorBusy = computed(() => isLoading.value || isNavigating.value || isMutating.value)
const canRestoreHistory = computed(() => saveState.value === 'saved' && !isNavigating.value && !isMutating.value && !needsRescheduleScope.value)
const hasPendingWorkspaceDraft = computed(() => hasUnsavedDrafts())

useAutoHideScrollbars()
useWorkspaceFocus({
  view, entries: visibleEntries, selectedId, detailMode,
  isBusy: () => isNavigating.value || isMutating.value,
})

useKeyboardShortcuts({
  view,
  entries: visibleEntries,
  selectedId,
  isEditing: () => detailMode.value !== 'empty',
  select: selectTask,
  toggleComplete: (task) => setStatus(task, task.status === 'completed' ? 'todo' : 'completed'),
  remove: removeTask,
  close: resetDraft,
  save: saveTask,
})

async function openSearchResult(task: Task, target: 'list' | 'detail') {
  await selectTask(task)
  // selectTask 完成不代表导航成功；草稿保护或异步失效后，须先核对实际选中项和待处理导航。
  if (selectedId.value !== task.id || pendingNavigation.value) return
  // 等待详情及虚拟列表目标行挂载，避免焦点查询命中旧 DOM。
  await nextTick()
  // 窄屏打开详情后列表会隐藏，即使从方向键进入也不能把焦点留在列表。
  if (target === 'detail' || window.matchMedia('(max-width: 820px)').matches) {
    focusVisible(document.getElementById('todou-task-title'))
  } else focusWorkspaceList(visibleEntries.value.map(({ task }) => task.id), task.id)
}
</script>

<template>
  <div class="app-shell tw:flex tw:flex-col tw:h-[100vh] tw:supports-[height:100dvh]:h-dvh tw:max-w-[1360px] tw:my-0 tw:mx-auto tw:pt-[calc(var(--space-lg)+env(safe-area-inset-top))] tw:px-[56px] tw:pb-lg tw:le-1040:ge-821:px-lg tw:le-820:pt-[calc(var(--space-sm)+env(safe-area-inset-top))] tw:le-820:px-[22px] tw:le-820:pb-[calc(80px+env(safe-area-inset-bottom))] tw:le-500:[&&]:px-sm">
    <a href="#todou-main-content" class="skip-link">{{ t('跳至主要内容') }}</a>
    <AppHeader :counts="headerCounts" :next-reminder="nextReminder" :now="now" :reminding="Boolean(activeReminder)" />
    <AppNav :current-view="view" :trash-count="deletedTasks.length" @select-view="openView" />
    <StatusBanner
      :error-message="errorMessage"
      :status-message="statusMessage"
      :save-state="saveState"
      :detail-mode="detailMode"
      :is-loading="isLoading"
      :needs-reschedule-scope="needsRescheduleScope"
      :has-pending-draft="hasPendingWorkspaceDraft"
      :can-retry="canRetryDatabase"
      :action-label="undoAvailable ? t('撤销') : ''"
      @retry="retryInitialization"
      @action="undoRemove"
    />
    <main id="todou-main-content" class="app-main tw:flex tw:flex-col tw:flex-1 tw:min-h-0" tabindex="-1">
    <LocalRecoveryPanel v-if="canRetryDatabase" :recovery="localRecovery" :saving="isSaving" />
    <DraftLeaveGuard :open="Boolean(pendingNavigation)" @continue-editing="continueEditing" @discard="discardChanges" />
    <ReminderToast :event="activeReminder" :position="reminderPosition" :busy="reminderActionBusy" :notification-error="notificationError" @snooze="snoozeReminder" @snooze-until="snoozeReminderUntil" @dismiss="dismissReminder" @complete="completeReminder" />

    <AuthorizationReturnLoading v-if="returnPhase === 'loading'" class="tw:mt-lg" />
    <p v-else-if="returnPhase === 'result'" class="inline-status tw:mt-lg tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-muted tw:[overflow-wrap:anywhere]" :class="{ error: connectionFailed }" :role="connectionFailed ? 'alert' : 'status'">{{ connectionMessage }}</p>
    <SettingsView
      v-if="connectionPanelVisible"
      :show-cloud="openSyncSettings || returnedToOneDrive"
      :ui-theme="uiTheme"
      :category-count="categories.length"
      :default-follow-up-minutes="reminderSettings.followUpMinutes"
      :is-saving="isSaving"
      :is-database-ready="isDatabaseReady"
      @update-theme="saveUiTheme"
      @update-default-follow-up="updateDefaultFollowUpMinutes"
    >
      <template #dataBackup>
        <SettingsDataPanel
          :backups="backups"
          :recovery="localRecovery"
          :is-saving="isSaving"
          :is-database-ready="isDatabaseReady"
          @export-data="exportLocalData"
        />
      </template>
      <template #categories>
        <CategorySettings
          :categories="categories"
          :tags="tags"
          :default-completion-strategy="defaultCompletionStrategy"
          :default-follow-up-minutes="reminderSettings.followUpMinutes"
          :disabled="isSaving || !isDatabaseReady"
          :edit-category="editCategory"
          :edit-tag="editTag"
          :add-category="addCategory"
          @update-default-strategy="updateDefaultCompletionStrategy"
          @update-category-follow-up="updateCategoryFollowUpMinutes"
        />
      </template>
    </SettingsView>

    <section v-else-if="view !== 'settings'" class="workspace tw:grid tw:grid-cols-[minmax(300px,.8fr)_minmax(420px,1.2fr)] tw:gap-x-2xl tw:le-1040:grid-cols-[minmax(280px,.85fr)_minmax(360px,1.15fr)] tw:le-1040:gap-x-xl tw:[&.workspace-list-only:not(:has(>.task-detail-exiting))]:grid-cols-[minmax(0,1fr)] tw:le-820:block" :class="{ 'workspace-list-only': detailMode === 'empty', 'workspace-trash': showTrash }" :aria-label="t('本地任务工作区')">
      <TaskListPanel
        :search-query="searchQuery"
        :list-filter="listFilter"
        :search-tokens="searchTokens"
        :search-active="searchActive"
        :conditions-active="filterPresets.active.value"
        :search-index="searchIndex"
        :now="now"
        :entries="visibleEntries"
        :list-tasks="tasks"
        :deleted-tasks="deletedTasks"
        :visible-checklist-items="visibleChecklistItems"
        :selected-id="selectedId"
        :show-trash="showTrash"
        :is-loading="isLoading"
        @update:search-query="setSearchQuery"
        @select-filter="changeListFilter"
        @new-task="startNewTask"
        @select-task="selectTask"
        @open-search-result="openSearchResult"
        @set-status="setStatus"
        @restore-task="restoreTask"
        @permanently-delete-task="permanentlyDeleteTask"
        @remove-task="removeTask"
      >
        <template #templates>
          <TaskTemplates :templates="templates" :busy="templatesBusy" @apply="applyTemplate" @remove="deleteTemplate" />
        </template>
        <template #filters>
          <TaskFilterPanel :filters="filterPresets" :categories="categories" :tags="tags" />
        </template>
      </TaskListPanel>

      <TaskDetailPanel :mode="detailMode" :in-trash="showTrash" @close="resetDraft">
        <TaskEditorForm
          v-model:related-task-ids="relatedTaskIds"
          :draft="draft"
          :selected-id="selectedId"
          :categories="categories"
          :tags="tags"
          :available-related-tasks="availableRelatedTasks"
          :saved-task="selectedTask"
          :runtime="selectedId ? reminderRuntime['task:' + selectedId] : undefined"
          :now="now"
          :add-tag="addTag"
          :is-saving="isSaving"
          :save-state="saveState"
          :reschedule-scope="rescheduleScope"
          :needs-reschedule-scope="needsRescheduleScope"
          :is-loading="editorBusy"
          :inherited-follow-up-minutes="inheritedFollowUpMinutes"
          @update:reschedule-scope="chooseRescheduleScope"
          @open-related-task="selectTask"
          @submit="saveTask"
          @cancel="resetDraft"
          @create-occurrence="createOccurrence"
        />

        <template #extras>
          <TaskTemplates v-if="selectedTask" :templates="templates" :source="selectedTask" :busy="isMutating || isNavigating || isSaving" @save="saveTemplate" />
          <ChecklistPanel
            :key="selectedId ?? undefined"
            :selected-id="selectedId"
            :items="checklistItems"
            :parent-status="selectedTask?.status"
          />

          <HistoryPanel
            :entries="history"
            :current="selectedTask"
            :other-tasks="availableRelatedTasks"
            :categories="categories"
            :tags="tags"
            :can-restore="canRestoreHistory"
            :can-restore-field="!editorBusy && !recoveryRequired"
            @restore="restoreHistory"
          />
        </template>
      </TaskDetailPanel>
    </section>
    </main>

    <SyncErrorToast
      v-if="isDatabaseReady"
      :active="view !== 'settings'"
      @settings="openView('settings', true)"
    />
  </div>
</template>
