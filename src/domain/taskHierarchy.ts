import type { Task } from '../storage/types'

export type TaskListEntry = { task: Task; depth: number }

/**
 * 按父先子后排列可见任务，同级保留输入顺序。
 * 父任务因筛选、删除或缺失而不在当前列表时将子任务作为根显示；自引用也按根处理。
 * 这里只整理展示顺序，不修复存储关系；每项最多输出一次，避免异常环导致死循环。
 */
export function orderByHierarchy(tasks: Task[]): TaskListEntry[] {
  const visible = new Set(tasks.map((task) => task.id))
  const children = new Map<string, Task[]>()
  const roots: Task[] = []
  for (const task of tasks) {
    const parentId = task.parentTaskId
    if (parentId && parentId !== task.id && visible.has(parentId)) {
      const siblings = children.get(parentId) ?? []
      siblings.push(task)
      children.set(parentId, siblings)
    } else {
      roots.push(task)
    }
  }

  const ordered: TaskListEntry[] = []
  const emitted = new Set<string>()
  function walk(root: Task) {
    if (emitted.has(root.id)) return
    const stack: TaskListEntry[] = [{ task: root, depth: 0 }]
    while (stack.length) {
      const entry = stack.pop()!
      if (emitted.has(entry.task.id)) continue
      emitted.add(entry.task.id)
      ordered.push(entry)
      const siblings = children.get(entry.task.id)
      if (!siblings) continue
      for (let i = siblings.length - 1; i >= 0; i--) {
        stack.push({ task: siblings[i]!, depth: entry.depth + 1 })
      }
    }
  }
  for (const root of roots) walk(root)
  // 无根环从输入顺序中首个未输出项以深度 0 补遍历，后续仍按子层级展开，并非全部平铺。
  for (const task of tasks) walk(task)
  return ordered
}
