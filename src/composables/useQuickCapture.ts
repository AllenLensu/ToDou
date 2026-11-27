import { useBatchCaptureDraft } from './useBatchCapture'
import { notice, t } from '../i18n'
import { computed, reactive, readonly, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import { fromLocalDateTime } from '../domain/localDateTime'
import { previewReminder } from '../application/reminderService'
import type { QuickAddInput, QuickAddReminderDraft } from '../domain/quickAddTime'
import type { ReminderSettings, TaskStore } from '../storage/types'

interface QuickCaptureOptions {
  store: MaybeRefOrGetter<TaskStore | null>
  canSubmit: () => boolean
  reminderSettings: ReminderSettings
  now: MaybeRefOrGetter<Date>
  onRefresh: () => Promise<void>
  onNotice: (message: () => string) => void
  onClearError: () => void
  onError: (error: unknown) => void
}

/** 列表顶部快速录入会话：管理标题草稿、确认后的提醒草稿、提交互斥与提醒预览。 */
export function useQuickCapture(options: QuickCaptureOptions) {
  const title = shallowRef('')
  const reminder = reactive<QuickAddReminderDraft>({ showReminder: false, date: '', time: '' })
  const busy = shallowRef(false)
  const batchDraft = useBatchCaptureDraft(options.now)

  async function submitBatch() {
    const db = toValue(options.store)
    const inputs = batchDraft.inputs.value
    if (!db || busy.value || !options.canSubmit() || !inputs.length) return
    busy.value = true
    let committed = false
    try {
      await db.createTasks(inputs)
      committed = true
      batchDraft.discard()
      options.onClearError()
      await options.onRefresh()
      options.onNotice(notice('[已创建] {0} 项任务', inputs.length))
    } catch (error) {
      options.onError(committed
        ? new Error(t('已创建 {0} 项任务，刷新列表失败。{1}', inputs.length, error instanceof Error ? error.message : String(error)))
        : error)
    } finally {
      busy.value = false
    }
  }

  function setTitle(value: string) {
    title.value = value
  }

  function updateReminder(changes: Partial<QuickAddReminderDraft>) {
    Object.assign(reminder, changes)
  }

  function clearReminder() {
    Object.assign(reminder, { showReminder: false, date: '', time: '' })
  }

  function discardSingle() {
    title.value = ''
    clearReminder()
  }

  function discard() {
    discardSingle()
    batchDraft.discard()
  }

  function hasDraft() {
    return Boolean(title.value || reminder.date || reminder.time || batchDraft.draft.value?.text.trim())
  }

  function previewQuickReminder(local: string) {
    try {
      const time = fromLocalDateTime(local)
      return time ? previewReminder(time, options.reminderSettings, toValue(options.now)) : ''
    } catch {
      return t('请选择有效的提醒时间。')
    }
  }

  /** 时间候选须由输入组件确认；原文回车仍按只填标题保存。 */
  async function submit(input?: QuickAddInput) {
    const db = toValue(options.store)
    if (!db || busy.value || !options.canSubmit()) return
    const capturedTitle = title.value
    const trimmed = (input?.title ?? capturedTitle).trim()
    if (!trimmed) return
    busy.value = true
    try {
      await db.createTask({ title: trimmed, remindAt: input?.remindAt ?? null })
      if (title.value === capturedTitle) {
        discardSingle()
      }
      options.onClearError()
      await options.onRefresh()
      options.onNotice(notice('[已创建] {0}', trimmed))
    } catch (error) {
      options.onError(error)
    } finally {
      busy.value = false
    }
  }

  return {
    batch: { ...batchDraft, canSubmit: computed(options.canSubmit), submit: submitBatch },
    title,
    reminder,
    busy: readonly(busy),
    setTitle,
    updateReminder,
    clearReminder,
    discard,
    hasDraft,
    previewQuickReminder,
    submit,
  }
}

export type QuickCaptureControls = ReturnType<typeof useQuickCapture>
