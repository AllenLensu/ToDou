import {computed, onBeforeUnmount, shallowRef, watch, type Ref} from 'vue';
import {notice} from '../i18n';
import type {Task} from '../storage/types';

const UNDO_WINDOW_MS = 5000;

interface UndoTarget {
  taskId: string;
  reselect: boolean;
}

/** Keeps one undo action alive while its deletion notice is still displayed. */
export function useTaskDeleteUndo(statusNotice: Ref<(() => string) | null>) {
  const pending = shallowRef<{target: UndoTarget; message: () => string} | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const available = computed(() => pending.value !== null && statusNotice.value === pending.value.message);

  function clear() {
    clearTimeout(timer);
    timer = undefined;
    pending.value = null;
  }

  function offer(task: Pick<Task, 'id' | 'title'>, reselect: boolean) {
    clear();
    const message = notice('[已移入回收站] {0}', task.title);
    statusNotice.value = message;
    pending.value = {target: {taskId: task.id, reselect}, message};
    timer = setTimeout(clear, UNDO_WINDOW_MS);
  }

  function take() {
    const target = pending.value?.target ?? null;
    clear();
    return target;
  }

  watch(statusNotice, message => {
    if (pending.value && message !== pending.value.message) clear();
  });
  onBeforeUnmount(clear);
  return {available, offer, take};
}
