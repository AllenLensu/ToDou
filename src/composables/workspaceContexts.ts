import { computed, inject, provide, readonly, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { Category, ChecklistItem, Tag } from '../storage/types'
import type { QuickAddInput, QuickAddReminderDraft } from '../domain/quickAddTime'
import type { SaveChecklistItem } from '../domain/taskUi'
import type { FieldChange } from '../sync/fieldMerge'
import type { DeviceSyncControls } from './useDeviceSync'
import type { SharedRestoreControls } from './useSharedRestore'
import type { NewChecklistPayload } from './useChecklistWorkflow'
import type { QuickCaptureControls } from './useQuickCapture'

export interface NotificationPermissionContext {
  permission: Readonly<Ref<NotificationPermission | 'unsupported'>>
  requestPermission: () => void | Promise<void>
}

const notificationPermissionKey: InjectionKey<NotificationPermissionContext> = Symbol('notificationPermission')

export function provideNotificationPermission(
  permission: Readonly<Ref<NotificationPermission | 'unsupported'>>,
  requestPermission: () => void | Promise<void>,
): NotificationPermissionContext {
  const context: NotificationPermissionContext = {
    permission: readonly(permission),
    requestPermission,
  }
  provide(notificationPermissionKey, context)
  return context
}

export function useOptionalNotificationPermission(): NotificationPermissionContext | undefined {
  return inject(notificationPermissionKey, undefined)
}

export interface TaxonomyLookupContext {
  tagsById: ComputedRef<ReadonlyMap<string, Tag>>
  categoriesById: ComputedRef<ReadonlyMap<string, Category>>
  tagLabel: (tagId: string) => string
}

const taxonomyLookupKey: InjectionKey<TaxonomyLookupContext> = Symbol('taxonomyLookup')

export function provideTaxonomyLookup(
  tags: Readonly<Ref<readonly Tag[]>>,
  categories: Readonly<Ref<readonly Category[]>>,
): TaxonomyLookupContext {
  const tagsById = computed<ReadonlyMap<string, Tag>>(() => new Map(tags.value.map(tag => [tag.id, tag])))
  const categoriesById = computed<ReadonlyMap<string, Category>>(() => new Map(categories.value.map(category => [category.id, category])))
  const context: TaxonomyLookupContext = {
    tagsById,
    categoriesById,
    tagLabel: (tagId: string) => tagsById.value.get(tagId)?.name ?? tagId,
  }
  provide(taxonomyLookupKey, context)
  return context
}

export function useOptionalTaxonomyLookup(): TaxonomyLookupContext | undefined {
  return inject(taxonomyLookupKey, undefined)
}

export interface ChecklistActionsContext {
  addItem: (payload: NewChecklistPayload) => Promise<boolean>
  saveItem: SaveChecklistItem
  toggleItem: (item: ChecklistItem) => Promise<void> | void
  removeItem: (item: ChecklistItem) => Promise<void> | void
}

const checklistActionsKey: InjectionKey<ChecklistActionsContext> = Symbol('checklistActions')

export function provideChecklistActions(actions: ChecklistActionsContext): ChecklistActionsContext {
  provide(checklistActionsKey, actions)
  return actions
}

export function useOptionalChecklistActions(): ChecklistActionsContext | undefined {
  return inject(checklistActionsKey, undefined)
}

export interface QuickCaptureContext {
  batch?: QuickCaptureControls['batch']
  title: Readonly<Ref<string>>
  reminder: Readonly<QuickAddReminderDraft>
  canQuickAdd: ComputedRef<boolean>
  setTitle: (value: string) => void
  updateReminder: (changes: Partial<QuickAddReminderDraft>) => void
  clearReminder: () => void
  previewReminder: (local: string) => string
  submit: (input?: QuickAddInput) => Promise<void> | void
}

export const quickCaptureContextKey: InjectionKey<QuickCaptureContext> = Symbol('quickCapture')

export function provideQuickCapture(
  capture: QuickCaptureControls,
  isDatabaseReady: Readonly<Ref<boolean>>,
): QuickCaptureContext {
  const context: QuickCaptureContext = {
    batch: capture.batch,
    title: readonly(capture.title),
    reminder: readonly(capture.reminder),
    canQuickAdd: computed(() => isDatabaseReady.value && !capture.busy.value),
    setTitle: capture.setTitle,
    updateReminder: capture.updateReminder,
    clearReminder: capture.clearReminder,
    previewReminder: capture.previewQuickReminder,
    submit: capture.submit,
  }
  provide(quickCaptureContextKey, context)
  return context
}

export function useQuickCaptureContext(): QuickCaptureContext {
  const context = inject(quickCaptureContextKey)
  if (!context) throw new Error('useQuickCaptureContext requires a QuickCapture provider')
  return context
}

export interface CloudSyncContext {
  sync: DeviceSyncControls
  sharedRestore: SharedRestoreControls
  syncItemLabel: (change: FieldChange) => string
}

const cloudSyncKey: InjectionKey<CloudSyncContext> = Symbol('cloudSync')

export function provideCloudSync(context: CloudSyncContext): CloudSyncContext {
  provide(cloudSyncKey, context)
  return context
}

export function useCloudSync(): CloudSyncContext {
  const context = inject(cloudSyncKey)
  if (!context) throw new Error('useCloudSync requires a CloudSync provider')
  return context
}

export function useOptionalCloudSync(): CloudSyncContext | undefined {
  return inject(cloudSyncKey, undefined)
}
