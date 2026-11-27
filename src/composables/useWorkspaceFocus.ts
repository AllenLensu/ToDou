import { nextTick, onBeforeUnmount, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { AppView } from '../domain/taskUi'
import type { TaskListEntry } from '../domain/taskHierarchy'
import { createAsyncFocus } from '../application/asyncFocus'

export const WORKSPACE_LIST_ID = 'todou-workspace-list'
export const WORKSPACE_DETAIL_ID = 'todou-workspace-detail'
export const DETAIL_HEADING_ID = 'todou-detail-heading'
export const NEW_TASK_ID = 'todou-new-task'

/** 隐藏、卸载或禁用的节点不接收焦点；聚焦后只滚动到最近可见位置。 */
export function focusVisible(element: HTMLElement | null) {
  if (!element || !element.isConnected || element.getClientRects().length === 0 || element.matches(':disabled')) return false
  element.focus({ preventScroll: true })
  element.scrollIntoView({ block: 'nearest' })
  return document.activeElement === element
}

export function focusWorkspaceList(ids: string[], preferredId: string | null, preferredIndex = 0) {
  // 原任务已离开当前列表时按原索引找邻项；没有可见行时退到新建入口或列表本身。
  const taskId = preferredId && ids.includes(preferredId) ? preferredId : ids[Math.min(preferredIndex, ids.length - 1)]
  const row = taskId
    ? document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"] .task-main-selectable`)
    : null
  return focusVisible(row)
    || focusVisible(document.getElementById('todou-quick-add'))
    || focusVisible(document.getElementById(NEW_TASK_ID))
    || focusVisible(document.getElementById(WORKSPACE_LIST_ID))
}

type Options = {
  view: MaybeRefOrGetter<AppView>
  entries: MaybeRefOrGetter<readonly TaskListEntry[]>
  selectedId: MaybeRefOrGetter<string | null>
  detailMode: MaybeRefOrGetter<'empty' | 'create' | 'edit'>
  isBusy?: MaybeRefOrGetter<boolean>
}

/** 观察导航后的实际状态而非点击意图恢复焦点；记住原行位置，任务消失时可落到邻项。 */
export function useWorkspaceFocus(options: Options) {
  const pendingFocus = createAsyncFocus(nextTick)
  let returnId: string | null = null
  let returnIndex = 0
  let returningToList = false
  const ids = () => toValue(options.entries).map(({ task }) => task.id)

  watch(() => [toValue(options.view), toValue(options.detailMode), toValue(options.selectedId), Boolean(toValue(options.isBusy))] as const,
    ([view, mode, selectedId], [previousView, previousMode]) => {
      if (mode === 'create' && previousMode !== 'create') {
        returnId = null
        returnIndex = -1
      }
      if (selectedId) {
        returnId = selectedId
        const index = ids().indexOf(selectedId)
        if (index >= 0) returnIndex = index
      }
      if (view !== previousView) returningToList = false
      if (view === 'settings') { pendingFocus.cancel(); return }
      if (mode === 'empty' && previousMode !== 'empty' && view === previousView) returningToList = true
      if (mode === 'empty' && returningToList) {
        // 导航／写入未结束时保留返回意图；忙碌状态变化会重试，下一轮渲染后再核对页面。
        void pendingFocus.after(() => undefined,
          () => !toValue(options.isBusy) && toValue(options.detailMode) === 'empty' && toValue(options.view) === view,
          () => { returningToList = false; focusWorkspaceList(ids(), returnId, returnIndex) })
      } else if (mode !== 'empty' && (mode === 'create' || window.matchMedia('(max-width: 820px)').matches)) {
        // 新建或窄屏进入详情时移入编辑区；宽屏查看已有任务则保留列表焦点，便于连续选行。
        returningToList = false
        void pendingFocus.after(() => undefined,
          () => !toValue(options.isBusy) && toValue(options.detailMode) !== 'empty' && toValue(options.selectedId) === selectedId && toValue(options.view) === view,
          () => { focusVisible(document.getElementById('todou-task-title')) || focusVisible(document.getElementById(DETAIL_HEADING_ID)) })
      } else {
        pendingFocus.cancel()
      }
    })

  watch(ids, (current, previous) => {
    if (toValue(options.view) === 'settings' || toValue(options.detailMode) !== 'empty') return
    const active = document.activeElement?.closest<HTMLElement>('[data-task-id]')
    const activeId = active?.dataset.taskId
    if (!activeId || current.includes(activeId)) return
    const index = previous.indexOf(activeId)
    returnId = null
    returnIndex = Math.max(0, index)
    returningToList = true
    void pendingFocus.after(() => undefined,
      () => !toValue(options.isBusy) && toValue(options.detailMode) === 'empty' && toValue(options.view) !== 'settings',
      () => { returningToList = false; focusWorkspaceList(ids(), returnId, returnIndex) })
  })

  onBeforeUnmount(() => pendingFocus.cancel())
}
