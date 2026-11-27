import { inject, onScopeDispose, provide, shallowRef, type InjectionKey } from 'vue'
import { toLocalDateTime } from '../domain/localDateTime'
import type { ChecklistEditDraft } from '../domain/taskUi'

type DraftGroup = Map<string, ChecklistEditDraft>
const draftGroupsKey: InjectionKey<{ groups: Set<DraftGroup>; notify: () => void }> = Symbol('checklist-edit-drafts')
type PendingEditor = { hasChanges: () => boolean; discard: () => void }
const pendingEditorsKey: InjectionKey<{ editors: Set<PendingEditor>; notify: () => void }> = Symbol('pending-editor-drafts')
const newChecklistEditorsKey: InjectionKey<{ editors: Set<PendingEditor>; notify: () => void }> = Symbol('new-checklist-drafts')

export function usePendingEditorDraft(hasChanges: () => boolean, discard: () => void) {
  const registry = inject(pendingEditorsKey, null)
  if (!registry) return
  const editor = { hasChanges, discard }
  registry.editors.add(editor)
  registry.notify()
  onScopeDispose(() => {
    registry.editors.delete(editor)
    registry.notify()
  })
}

export function useNewChecklistDraftGuard(hasChanges: () => boolean, discard: () => void) {
  const registry = inject(newChecklistEditorsKey, null)
  if (!registry) {
    usePendingEditorDraft(hasChanges, discard)
    return
  }
  const editor = { hasChanges, discard }
  registry.editors.add(editor)
  registry.notify()
  onScopeDispose(() => {
    registry.editors.delete(editor)
    registry.notify()
  })
}

export function useChecklistEditDrafts(): DraftGroup {
  const group: DraftGroup = new Map()
  const registry = inject(draftGroupsKey, null)
  if (registry) {
    registry.groups.add(group)
    registry.notify()
    onScopeDispose(() => {
      registry.groups.delete(group)
      registry.notify()
    })
  }
  return group
}

export function provideChecklistEditDrafts() {
  const groups = new Set<DraftGroup>()
  const editors = new Set<PendingEditor>()
  const newChecklistEditors = new Set<PendingEditor>()
  const revision = shallowRef(0)
  const notify = () => { revision.value++ }

  provide(draftGroupsKey, { groups, notify })
  provide(pendingEditorsKey, { editors, notify })
  provide(newChecklistEditorsKey, { editors: newChecklistEditors, notify })

  const hasNewChecklistChanges = () => {
    void revision.value
    for (const editor of newChecklistEditors) if (editor.hasChanges()) return true
    return false
  }

  const discardNewChecklist = () => {
    for (const editor of newChecklistEditors) editor.discard()
    notify()
  }

  return {
    hasNewChecklistChanges,
    discardNewChecklist,
    hasChanges: () => {
      void revision.value
      if (hasNewChecklistChanges()) return true
      for (const editor of editors) if (editor.hasChanges()) return true
      for (const group of groups) for (const draft of group.values()) {
        const original = draft.original
        if (draft.editing && (draft.title !== original.title || draft.notes !== original.notes
          || draft.remindAt !== toLocalDateTime(original.remindAt) || draft.recurrenceMode !== original.recurrenceMode
          || draft.recurrenceRule !== original.recurrenceRule)) return true
      }
      return false
    },
    discard: () => {
      discardNewChecklist()
      for (const editor of editors) editor.discard()
      for (const group of groups) {
        for (const draft of group.values()) draft.editing = false
        group.clear()
      }
      notify()
    },
  }
}
