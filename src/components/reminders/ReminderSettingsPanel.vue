<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n'

import type { ReminderStrength, TaskReminderSettings } from '../../storage/types'
import { useOptionalNotificationPermission } from '../../composables/workspaceContexts'
import NothingInput from '../ui/NothingInput.vue'

/** 以不可变新对象更新任务提醒设置，由父级随任务保存；修改设置不会申请系统通知权限。 */
const settings = defineModel<TaskReminderSettings>({ required: true })

// 权限默认从工作区通知权限上下文读取；可选 prop 供独立挂载测试覆盖。
const props = defineProps<{
  notificationPermission?: NotificationPermission | 'unsupported'
  inheritedFollowUpMinutes: number
}>()

const emit = defineEmits<{
  requestPermission: []
}>()

const permissionContext = useOptionalNotificationPermission()
const effectivePermission = computed(() => props.notificationPermission ?? permissionContext?.permission.value ?? 'default')

function requestPermission() {
  if (permissionContext) void permissionContext.requestPermission()
  else emit('requestPermission')
}

function patch(changes: Partial<TaskReminderSettings>) {
  settings.value = { ...settings.value, ...changes }
}

function updateFollowUpSource(value: string | number) {
  if (value === 'inherit') patch({ followUpMinutes: null })
  else if (settings.value.followUpMinutes === null) patch({ followUpMinutes: props.inheritedFollowUpMinutes })
}

function updateFollowUpMinutes(value: string | number) {
  patch({ followUpMinutes: value === '' ? null : Number(value) })
}

function updateStrength(value: string | number) {
  if (value === 'normal' || value === 'alarm') patch({ strength: value as ReminderStrength })
}
</script>

<template>
  <div class="settings-grid task-reminder-settings tw:grid tw:grid-cols-[1fr_1fr] tw:gap-y-sm tw:gap-x-md tw:items-end tw:le-500:grid-cols-[1fr]">
    <label class="setting-toggle tw:inline-flex tw:items-center tw:gap-[10px] tw:min-h-[44px] tw:text-text">
      <input :checked="settings.mode === 'notification'" class="tw:w-[20px] tw:min-h-[20px]" type="checkbox" @change="patch({ mode: ($event.target as HTMLInputElement).checked ? 'notification' : 'none' })" />
      <span class="tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.04em]">{{ t('开启本机提醒') }}</span>
    </label>
    <button
      v-if="effectivePermission !== 'granted'"
      class="button button-secondary setting-permission tw:justify-self-start tw:min-h-[44px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:bg-surface-raised tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:active:border-text-display tw:active:text-text-display tw:disabled:cursor-wait tw:disabled:opacity-50"
      type="button"
      @click="requestPermission"
    >
      {{ effectivePermission === 'denied' ? t('重新开启通知权限') : t('允许系统通知') }}
    </button>
    <span v-else class="permission-state tw:min-h-[44px] tw:inline-flex tw:items-center tw:text-success tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.04em]" role="status">{{ t('系统通知已开启') }}</span>

    <div class="setting-field tw:grid tw:gap-xs">
      <NothingInput :model-value="settings.followUpMinutes === null ? 'inherit' : 'custom'" :label="t('追提醒间隔来源')" :show-label="true" kind="select" @update:model-value="updateFollowUpSource" :help="settings.followUpMinutes === null ? t('当前继承：每 {0} 分钟追提醒。', inheritedFollowUpMinutes) : undefined">
        <option value="inherit">{{ t('跟随分类或全局') }}</option>
        <option value="custom">{{ t('单独设置') }}</option>
      </NothingInput>
      <NothingInput v-if="settings.followUpMinutes !== null" :model-value="settings.followUpMinutes" :label="t('追提醒间隔（分钟）')" :show-label="true" type="number" min="5" max="1440" step="5" :placeholder="t('例如：30')" @update:model-value="updateFollowUpMinutes" />
    </div>
    <div class="setting-field tw:grid tw:gap-xs">
      <NothingInput :model-value="settings.strength" :label="t('提醒强度')" kind="select" :placeholder="t('选择普通通知或闹钟式提醒')" @update:model-value="updateStrength" show-label :help="t('网页使用系统通知。闹钟式请求通知保持显示，不会持续播放声音；声音和展示由浏览器及系统设置决定。')">
        <option value="normal">{{ t('普通通知') }}</option>
        <option value="alarm">{{ t('闹钟式提醒') }}</option>
      </NothingInput>
    </div>
    <label class="setting-toggle setting-toggle-wide tw:inline-flex tw:items-center tw:gap-[10px] tw:min-h-[44px] tw:text-text tw:col-[1/-1] tw:le-500:col-auto">
      <input :checked="settings.quietHoursEnabled" class="tw:w-[20px] tw:min-h-[20px]" type="checkbox" @change="patch({ quietHoursEnabled: ($event.target as HTMLInputElement).checked })" />
      <span class="tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.04em]">{{ t('免打扰时段') }}</span>
    </label>
    <div class="setting-field tw:grid tw:gap-xs">
      <NothingInput :model-value="settings.quietStart" :label="t('免打扰开始')" type="time" :placeholder="t('选择开始时间')" :disabled="!settings.quietHoursEnabled" @update:model-value="patch({ quietStart: String($event) })"  show-label/>
    </div>
    <div class="setting-field tw:grid tw:gap-xs">
      <NothingInput :model-value="settings.quietEnd" :label="t('免打扰结束')" type="time" :placeholder="t('选择结束时间')" :disabled="!settings.quietHoursEnabled" @update:model-value="patch({ quietEnd: String($event) })"  show-label/>
    </div>
    <label class="setting-toggle setting-toggle-wide tw:inline-flex tw:items-center tw:gap-[10px] tw:min-h-[44px] tw:text-text tw:col-[1/-1] tw:le-500:col-auto">
      <input :checked="settings.notifyAfterQuietHours" class="tw:w-[20px] tw:min-h-[20px]" type="checkbox" :disabled="!settings.quietHoursEnabled" @change="patch({ notifyAfterQuietHours: ($event.target as HTMLInputElement).checked })" />
      <span class="tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.04em]">{{ t('免打扰结束后补发提醒') }}</span>
    </label>
  </div>
  <small class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('提醒只在页面或 PWA 窗口仍运行时轮询。暂停或取消父任务也暂停检查项提醒；仅完成父任务时，未完成检查项继续提醒并沿用父任务设置。“知道了”仅关闭当次提醒，之后仍按间隔追提醒。') }}</small>
</template>
