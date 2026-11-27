<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { getLocale, t } from '../../i18n'
import { syncFeedbackText } from '../../sync/connectionFeedback'
import type { DeviceSyncControls } from '../../composables/useDeviceSync'
import { useOptionalCloudSync } from '../../composables/workspaceContexts'

// 仅在任务与回收站页面出现网盘同步错误时以浮层 Toast 通知，不在页面常态占用空间。
const props = withDefaults(defineProps<{
  sync?: DeviceSyncControls
  /** 当前页面是否允许弹出 Toast（任务、回收站为 true，设置页为 false）。 */
  active?: boolean
  /** 自动收起时长（毫秒）；默认 0（不自动收起，满足 WCAG 2.2.1 含交互按钮的错误提示不限时）。 */
  autoHideMs?: number
}>(), {
  active: true,
  autoHideMs: 0,
})

const emit = defineEmits<{ settings: [] }>()
const cloud = useOptionalCloudSync()
const sync = computed(() => {
  const resolved = props.sync ?? cloud?.sync
  if (!resolved) throw new Error('SyncErrorToast requires sync controls or CloudSyncContext')
  return resolved
})

/** 以原始错误文本组合追踪错误事件，避免切换界面语言误把已关闭的旧错误当成新错误。 */
const rawErrorKey = computed(() => [sync.value.message, sync.value.statusError].filter(Boolean).join('\0'))
const errorText = computed(() => {
  const items = [sync.value.message, sync.value.statusError].filter(Boolean).map(syncFeedbackText)
  return items.join(getLocale() === 'en' ? ' ' : '；')
})
const headingLabel = computed(() => !sync.value.message && sync.value.statusError
  ? t('网盘同步状态暂不可读')
  : t('网盘同步未完成'))
const canRetry = computed(() => Boolean(sync.value.scope && sync.value.enabled))

const visible = shallowRef(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined
let pausedByInteraction = false
let dismissedKey = ''

function clearTimer() {
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
}

function scheduleHide() {
  clearTimer()
  if (!visible.value || pausedByInteraction || props.autoHideMs <= 0) return
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    visible.value = false
    dismissedKey = rawErrorKey.value
  }, props.autoHideMs)
}

function showToast() {
  pausedByInteraction = false
  visible.value = true
  scheduleHide()
}

function dismiss() {
  clearTimer()
  pausedByInteraction = false
  visible.value = false
  dismissedKey = rawErrorKey.value
}

function pauseTimer() {
  pausedByInteraction = true
  clearTimer()
}

function resumeTimer() {
  pausedByInteraction = false
  scheduleHide()
}

function onFocusOut(event: FocusEvent) {
  const current = event.currentTarget as HTMLElement | null
  const next = event.relatedTarget as Node | null
  if (current && next && current.contains(next)) return
  resumeTimer()
}

function retry() {
  clearTimer()
  pausedByInteraction = false
  visible.value = false
  dismissedKey = ''
  if (canRetry.value) void sync.value.synchronize()
  else emit('settings')
}

function openSettings() {
  dismiss()
  emit('settings')
}

watch(
  [rawErrorKey, () => sync.value.busy, () => props.active],
  ([key, busy, active], previous) => {
    const prevKey = previous?.[0] ?? ''
    const prevBusy = previous?.[1] ?? false

    // 同步恢复正常、清空错误或进入新一轮同步时，立即收起旧 Toast 并清空已关闭标记。
    if (!key || busy) {
      clearTimer()
      visible.value = false
      dismissedKey = ''
      return
    }
    if (!active) {
      // 在设置页期间产生的错误已由设置页内联展示，切回任务/回收站时不再重复弹同一条。
      clearTimer()
      visible.value = false
      dismissedKey = key
      return
    }

    const finishedFailedAttempt = prevBusy && !busy
    const errorChanged = key !== prevKey
    if (finishedFailedAttempt || errorChanged || key !== dismissedKey) {
      dismissedKey = ''
      showToast()
    }
  },
  { immediate: true },
)

onBeforeUnmount(clearTimer)
</script>

<template>
  <aside
    v-if="visible && active && errorText"
    class="sync-error-toast"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    :aria-label="t('网盘同步错误')"
    @mouseenter="pauseTimer"
    @mouseleave="resumeTimer"
    @focusin="pauseTimer"
    @focusout="onFocusOut"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div class="sync-error-toast-body">
      <span class="sync-error-toast-kicker">
        <span class="sync-error-toast-signal" aria-hidden="true"></span>
        {{ headingLabel }}
      </span>
      <p class="sync-error-toast-message">{{ errorText }}</p>
    </div>
    <div class="sync-error-toast-actions">
      <button
        v-if="canRetry"
        type="button"
        class="button button-quiet touch-target tw:shrink-0 tw:py-[8px] tw:px-[14px]"
        :disabled="sync.busy"
        @click="retry"
      >{{ t('重试同步') }}</button>
      <button
        type="button"
        class="sync-error-toast-link touch-target"
        @click="openSettings"
      >{{ t('同步设置') }}</button>
      <button
        type="button"
        class="sync-error-toast-link touch-target"
        :aria-label="t('关闭提示')"
        @click="dismiss"
      >{{ t('关闭') }}</button>
    </div>
  </aside>
</template>

<style scoped>
.sync-error-toast {
  position: fixed;
  right: var(--space-md);
  bottom: var(--space-md);
  z-index: 40;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  max-width: min(460px, calc(100vw - 32px));
  padding: 14px var(--space-sm);
  border: 1px solid var(--accent);
  border-radius: 0;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-data);
  font-size: var(--type-label);
  animation: motion-fade-in var(--motion-base) var(--ease-out) both;
}
.sync-error-toast-body { min-width: 0; flex: 1 1 auto; }
.sync-error-toast-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-text);
  letter-spacing: .08em;
  text-transform: uppercase;
}
.sync-error-toast-signal {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.sync-error-toast-message {
  margin: 4px 0 0;
  color: var(--text);
  font-family: var(--font-ui);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.sync-error-toast-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.sync-error-toast-button,
.sync-error-toast-link {
  min-height: 44px;
  color: var(--text);
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: opacity var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
}
.sync-error-toast-button {
  flex-shrink: 0;
  border: 1px solid var(--control-border);
  border-radius: 999px;
  padding: 8px 14px;
}
.sync-error-toast-link {
  border: 0;
  text-decoration: underline;
  padding: 0 8px;
}
.sync-error-toast-button:hover,
.sync-error-toast-link:hover {
  color: var(--text-display);
  border-color: var(--text);
}
.sync-error-toast-button:disabled {
  opacity: .5;
  cursor: wait;
}
@media (max-width: 820px) {
  .sync-error-toast {
    left: var(--space-sm);
    right: var(--space-sm);
    bottom: calc(76px + env(safe-area-inset-bottom));
    max-width: none;
    flex-direction: column;
    gap: 8px;
  }
  .sync-error-toast-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
