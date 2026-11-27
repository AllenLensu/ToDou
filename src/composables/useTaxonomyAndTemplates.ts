import { notice, t } from '../i18n'
import { readonly, shallowRef, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { captureTemplate, type TaskTemplate } from '../domain/taskTemplate'
import { applyTheme, cacheTheme, readCachedTheme } from '../application/theme'
import { runReminderTimeChange } from '../application/reminderReschedule'
import type {
  Category,
  ParentCompletionStrategy,
  ReminderSettings,
  Tag,
  Task,
  TaskStore,
  UiTheme,
} from '../storage/types'

interface TaxonomyAndTemplatesOptions {
  store: MaybeRefOrGetter<TaskStore | null>
  selectedId: MaybeRefOrGetter<string | null>
  tasks: MaybeRefOrGetter<readonly Task[]>
  categories: Ref<Category[]>
  tags: Ref<Tag[]>
  templates: Ref<TaskTemplate[]>
  reminderSettings: ReminderSettings
  canMutate: () => boolean
  withMutation: <T>(action: () => Promise<T>) => Promise<T>
  flushDraft: () => Promise<boolean>
  onTagAddedToDraft: (tagId: string) => void
  onTagRemovedFromDraft: (tagId: string) => void
  reminderLifecycle: { pause: () => Promise<void>; resume: () => Promise<void> }
  onRefreshTasks: () => Promise<void>
  onNotice: (message: () => string) => void
  onError: (error: unknown) => void
}

/** 管理分类、标签、任务模板、全局默认完成策略、追提醒默认间隔与界面主题。 */
export function useTaxonomyAndTemplates(options: TaxonomyAndTemplatesOptions) {
  const defaultCompletionStrategy = shallowRef<ParentCompletionStrategy | ''>('')
  const uiTheme = shallowRef<UiTheme>(readCachedTheme())

  function setDefaultStrategyFromSnapshot(strategy: ParentCompletionStrategy | null) {
    defaultCompletionStrategy.value = strategy ?? ''
  }

  function applyLoadedTheme(theme: UiTheme) {
    uiTheme.value = theme
    applyTheme(theme)
    cacheTheme(theme)
  }

  async function saveUiTheme(theme: UiTheme) {
    applyLoadedTheme(theme)
    const db = toValue(options.store)
    if (!db) return
    try {
      await db.setUiTheme(theme)
      options.onNotice(notice('[已保存主题]'))
    } catch (error) {
      options.onError(error)
    }
  }

  function tagLabel(tagId: string) {
    return options.tags.value.find((tag) => tag.id === tagId)?.name ?? tagId
  }

  async function saveTemplate(day: string) {
    const db = toValue(options.store)
    const id = toValue(options.selectedId)
    if (!db || !id || !options.canMutate()) return
    await options.withMutation(async () => {
      try {
        if (!await options.flushDraft() || id !== toValue(options.selectedId)) return
        const source = toValue(options.tasks).find(task => task.id === id)
        if (!source) return
        const category = options.categories.value.find(item => item.id === source.categoryId)
        await db.saveTemplate(captureTemplate(source, await db.listChecklistItems(id), day, category, options.reminderSettings))
        options.templates.value = await db.listTemplates()
        options.onNotice(notice('[已保存本机模板] {0}', source.title))
      } catch (error) {
        options.onError(error)
      }
    })
  }

  async function applyTemplate(id: string, day: string) {
    const db = toValue(options.store)
    if (!db || !options.canMutate()) return
    await options.withMutation(async () => {
      try {
        const task = await db.applyTemplate(id, day)
        await options.onRefreshTasks()
        options.onNotice(notice('[已从模板创建] {0}', task.title))
      } catch (error) {
        options.onError(error)
      }
    })
  }

  async function deleteTemplate(id: string) {
    const db = toValue(options.store)
    if (!db || !options.canMutate()) return
    await options.withMutation(async () => {
      try {
        await db.deleteTemplate(id)
        options.templates.value = await db.listTemplates()
        options.onNotice(notice('[已删除本机模板]'))
      } catch (error) {
        options.onError(error)
      }
    })
  }

  async function editCategory(id: string, changes: { name?: string; completionStrategy?: ParentCompletionStrategy | null }) {
    const db = toValue(options.store)
    if (!db) throw new Error(t('请等待本机数据准备就绪。'))
    await db.updateCategory(id, changes)
    options.categories.value = await db.listCategories()
  }

  async function editTag(id: string, name: string | null) {
    const db = toValue(options.store)
    if (!db) throw new Error(t('请等待本机数据准备就绪。'))
    if (name !== null) await db.renameTag(id, name)
    else {
      if (!await options.flushDraft()) throw new Error(t('请先保存当前编辑。'))
      await db.deleteTag(id)
      options.onTagRemovedFromDraft(id)
    }
    await options.onRefreshTasks()
  }

  async function addCategory(name: string, strategy: ParentCompletionStrategy | null) {
    const db = toValue(options.store)
    if (!db || !name.trim()) return false
    try {
      const category = await db.createCategory(name, strategy)
      options.categories.value = await db.listCategories()
      options.onNotice(notice('[已新增分类] {0}', category.name))
      return true
    } catch (error) {
      options.onError(error)
      return false
    }
  }

  async function addTag(name: string) {
    const db = toValue(options.store)
    if (!db || !name.trim()) return false
    try {
      const tag = await db.createTag(name)
      options.tags.value = await db.listTags()
      options.onTagAddedToDraft(tag.id)
      return true
    } catch (error) {
      options.onError(error)
      return false
    }
  }

  async function updateDefaultCompletionStrategy(strategy: ParentCompletionStrategy | '') {
    defaultCompletionStrategy.value = strategy
    const db = toValue(options.store)
    if (!db || !strategy) return
    try {
      await db.setDefaultCompletionStrategy(strategy)
      options.onNotice(notice('[已保存全局完成策略]'))
    } catch (error) {
      options.onError(error)
    }
  }

  async function updateDefaultFollowUpMinutes(minutes: number) {
    const db = toValue(options.store)
    if (!db) return
    try {
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) throw new Error(t('追提醒间隔须为 5–1440 分钟的整数'))
      await runReminderTimeChange(null, null, async () => {
        await toValue(options.store)!.setReminderSettings({ followUpMinutes: minutes })
      }, options.reminderLifecycle, true)
      options.onNotice(notice('[已保存全局追提醒间隔]'))
    } catch (error) {
      options.onError(error)
    }
  }

  async function updateCategoryFollowUpMinutes(id: string, minutes: number | null) {
    const db = toValue(options.store)
    if (!db) return
    try {
      await runReminderTimeChange(null, null, async () => {
        await toValue(options.store)!.updateCategory(id, { followUpMinutes: minutes })
      }, options.reminderLifecycle, true)
      options.onNotice(minutes === null ? notice('[分类追提醒已跟随全局]') : notice('[已保存分类追提醒间隔]'))
    } catch (error) {
      options.onError(error)
    }
  }

  return {
    defaultCompletionStrategy,
    uiTheme: readonly(uiTheme),
    setDefaultStrategyFromSnapshot,
    applyLoadedTheme,
    saveUiTheme,
    tagLabel,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
    editCategory,
    editTag,
    addCategory,
    addTag,
    updateDefaultCompletionStrategy,
    updateDefaultFollowUpMinutes,
    updateCategoryFollowUpMinutes,
  }
}
