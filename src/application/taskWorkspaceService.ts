// 聚合工作区读取和保存用例；界面状态由 composable 管理，事务及落盘由 TaskStore 负责。
import type { Category, ParentCompletionStrategy, Tag, Task, TaskHistoryEntry, TaskInput, ChecklistItem, TaskStore } from '../storage/types'
import type { ChecklistRow } from '../domain/taskUi'

export type WorkspaceSnapshot = {
  tasks: Task[]
  deletedTasks: Task[]
  categories: Category[]
  tags: Tag[]
  defaultCompletionStrategy: ParentCompletionStrategy | null
  allChecklistItems: ChecklistRow[]
}

export type TaskExtras = {
  history: TaskHistoryEntry[]
  checklistItems: ChecklistItem[]
  relatedTaskIds: string[]
}

export type SaveTaskCommand = {
  selectedId: string | null
  input: TaskInput
  relatedTaskIds: string[]
  editBatchId?: string
  scope?: 'this' | 'future'
}

export type SaveTaskResult = {
  task: Task
  created: boolean
}

export async function loadWorkspace(store: TaskStore): Promise<WorkspaceSnapshot> {
  // 刷新会补齐重复期次，生成后再读才能让新任务及其检查项出现在同一份快照中。
  await store.generateTaskOccurrences()
  const tasks = await store.listTasks()
  const deletedTasks = await store.listDeletedTasks()
  const categories = await store.listCategories()
  const tags = await store.listTags()
  const defaultCompletionStrategy = await store.getDefaultCompletionStrategy()
  const checklistByTask = new Map<string, ChecklistItem[]>()
  for (const item of await store.listAllChecklistItems()) {
    const group = checklistByTask.get(item.taskId) ?? []
    group.push(item)
    checklistByTask.set(item.taskId, group)
  }
  const rows = tasks.flatMap((task) => (checklistByTask.get(task.id) ?? []).map((item) => ({ ...item, taskTitle: task.title, parentStatus: task.status })))

  return {
    tasks,
    deletedTasks,
    categories,
    tags,
    defaultCompletionStrategy,
    allChecklistItems: rows,
  }
}

export async function loadTaskExtras(store: TaskStore, taskId: string): Promise<TaskExtras> {
  const history = await store.listHistory(taskId)
  const checklistItems = await store.listChecklistItems(taskId)
  const relations = await store.listTaskRelations(taskId)
  return {
    history,
    checklistItems,
    relatedTaskIds: relations.map((relation) => relation.relatedTaskId),
  }
}

export async function saveTask(store: TaskStore, command: SaveTaskCommand): Promise<SaveTaskResult> {
  const task = await store.saveTask(command.selectedId, command.input, command.relatedTaskIds, command.editBatchId, command.scope)
  return { task, created: command.selectedId === null }
}
