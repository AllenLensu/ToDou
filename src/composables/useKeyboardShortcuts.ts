import { nextTick, onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue'
import type { AppView } from '../domain/taskUi'
import type { TaskListEntry } from '../domain/taskHierarchy'
import type { Task } from '../storage/types'
import { createAsyncFocus } from '../application/asyncFocus'
import { singleKeyShortcutsEnabled } from '../application/keyboardShortcutsPreference'
import { DETAIL_HEADING_ID, focusVisible, focusWorkspaceList } from './useWorkspaceFocus'

export const QUICK_ADD_ID = 'todou-quick-add'
export const TASK_TITLE_ID = 'todou-task-title'

type Options = {
  view: MaybeRefOrGetter<AppView>
  entries: MaybeRefOrGetter<readonly TaskListEntry[]>
  selectedId: MaybeRefOrGetter<string | null>
  isEditing: MaybeRefOrGetter<boolean>
  /** 是否允许单字符快捷键（/、N、X）；默认跟随本机偏好。 */
  singleKeyShortcuts?: MaybeRefOrGetter<boolean>
  select: (task: Task) => void | Promise<void>
  toggleComplete: (task: Task) => Promise<void> | void
  remove: (task: Task) => void | Promise<void>
  close: () => void | Promise<void>
  save: () => Promise<boolean>
}

/** 输入控件和整个日期选择器（含未展开的触发按钮）保留自己的列表按键行为。 */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('input, textarea, select, [role="combobox"], [role="listbox"], [data-nothing-picker]')) return true
  return false
}

function focusById(id: string) {
  return focusVisible(document.getElementById(id))
}

/**
 * 任务／回收站列表快捷键；回收站禁用新建、完成和删除等任务写操作。
 * 选择及关闭仍经工作区的草稿保护，异步聚焦只跟随最新请求。
 * 输入控件不触发列表快捷键；Ctrl/Cmd+S 单独处理，中文组词期间所有按键均跳过。
 */
export function useKeyboardShortcuts(options: Options) {
  const pendingFocus = createAsyncFocus(nextTick)
  let requestedSelection: string | null = null

  function focusedTaskId() {
    return document.activeElement?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ?? null
  }

  function selectedTask() {
    const focusedId = focusedTaskId()
    // A day jump can focus a checklist while another task remains open in the editor.
    if (!focusedId && document.activeElement?.closest('button, [role="button"], [data-checklist-id], .checklist-edit-row')) return null
    const taskId = focusedId ?? toValue(options.selectedId)
    return toValue(options.entries).find((entry) => entry.task.id === taskId)?.task ?? null
  }

  function focusSelection() {
    const row = document.querySelector<HTMLElement>('.task-list [aria-current="true"]:not([inert] *)')
    if (focusVisible(row)) return
    if (toValue(options.isEditing)) {
      focusById(TASK_TITLE_ID) || focusById(DETAIL_HEADING_ID)
    } else {
      focusWorkspaceList(toValue(options.entries).map(({ task }) => task.id), focusedTaskId() ?? toValue(options.selectedId))
    }
  }

  function move(delta: number) {
    const list = toValue(options.entries)
    if (!list.length) return
    const index = list.findIndex((entry) => entry.task.id === (requestedSelection ?? focusedTaskId() ?? toValue(options.selectedId)))
    const next = index === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, index + delta))
    const task = list[next].task
    const view = toValue(options.view)
    // 连续方向键按最新请求推进；select 返回不代表导航已成功，聚焦前还要核对选中项与视图。
    requestedSelection = task.id
    void pendingFocus.after(() => options.select(task),
      () => toValue(options.selectedId) === task.id && toValue(options.view) === view,
      focusSelection).finally(() => { if (requestedSelection === task.id) requestedSelection = null })
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (toValue(options.isEditing) && toValue(options.view) === 'tasks') void options.save()
      return
    }
    // 已打开行的 Enter 进入标题；行组件自身的 Enter 仅负责选择任务。
    if (event.key === 'Enter' && event.target instanceof HTMLElement && event.target.matches('.task-main-selectable[aria-current="true"]')) {
      const task = selectedTask()
      if (toValue(options.view) === 'tasks' && task) {
        void pendingFocus.after(() => options.select(task),
          () => toValue(options.view) === 'tasks' && toValue(options.selectedId) === task.id,
          () => { focusById(TASK_TITLE_ID) })
      }
      return
    }
    if (event.defaultPrevented || event.isComposing) return
    const view = toValue(options.view)
    if (view === 'settings') return
    const inTrash = view === 'trash'

    if (event.key === 'Escape') {
      if (isTypingTarget(event.target)) {
        // 此处只尝试移出输入焦点，不关闭任务；日期面板的 Esc 已由控件拦截并关闭面板。
        (event.target as HTMLElement).closest<HTMLElement>('input, textarea, [role="combobox"], .nothing-picker-trigger')?.blur()
        return
      }
      if (toValue(options.isEditing)) {
        event.preventDefault()
        // 这里只请求关闭；工作区焦点逻辑待详情实际关闭后，按原行或原索引恢复。
        void options.close()
      }
      return
    }

    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const allowSingleKey = toValue(options.singleKeyShortcuts ?? singleKeyShortcutsEnabled)

    if (key === '/' && !inTrash) {
      if (allowSingleKey && focusById('todou-task-search')) event.preventDefault()
    } else if (key === 'n' && !inTrash) {
      if (allowSingleKey && focusById(QUICK_ADD_ID)) event.preventDefault()
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      // 仅在页面主体或任务列表区内响应方向键切换任务，避免劫持导航栏、筛选器或详情控件的键盘滚动。
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target && target !== document.body && !target.closest('.task-list, .task-motion-list, [data-task-id]')) return
      event.preventDefault()
      move(key === 'ArrowDown' ? 1 : -1)
    } else if (key === 'Enter') {
      // 行和按钮自行处理 Enter；仅从页面 body 跳入已打开任务的标题。
      if (event.target instanceof HTMLElement && event.target !== document.body) return
      if (selectedTask() && !inTrash && focusById(TASK_TITLE_ID)) event.preventDefault()
    } else if (key === 'x' && !inTrash) {
      if (!allowSingleKey) return
      const task = selectedTask()
      if (task) {
        event.preventDefault()
        const entries = toValue(options.entries)
        const index = entries.findIndex(({ task: item }) => item.id === task.id)
        void pendingFocus.after(() => options.toggleComplete(task), () => toValue(options.view) === view,
          () => {
            if (toValue(options.isEditing)) focusSelection()
            else focusWorkspaceList(toValue(options.entries).map(({ task: item }) => item.id), task.id, Math.max(0, index))
          })
      }
    } else if (key === 'Delete' && !inTrash) {
      const task = selectedTask()
      if (task) {
        event.preventDefault()
        const entries = toValue(options.entries)
        const index = entries.findIndex(({ task: item }) => item.id === task.id)
        void pendingFocus.after(() => options.remove(task),
          () => toValue(options.view) === view,
          () => {
            if (toValue(options.isEditing)) focusSelection()
            else focusWorkspaceList(toValue(options.entries).map(({ task: item }) => item.id), task.id, Math.max(0, index))
          })
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => {
    pendingFocus.cancel()
    window.removeEventListener('keydown', onKeydown)
  })
}
