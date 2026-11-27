<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n'
import { useOptionalNotificationPermission } from '../../composables/workspaceContexts'

const props = defineProps<{ permission?: NotificationPermission | 'unsupported' }>()
const emit = defineEmits<{ request: [] }>()
const context = useOptionalNotificationPermission()
const effectivePermission = computed(() => props.permission ?? context?.permission.value ?? 'default')
const permissionSummary = computed(() => {
  if (effectivePermission.value === 'granted') return t('本机已允许通知。')
  if (effectivePermission.value === 'denied') return t('本机通知已关闭。请在浏览器的站点权限中允许通知。')
  if (effectivePermission.value === 'unsupported') return t('当前环境不支持系统通知。')
  return t('本机尚未允许通知。')
})
const hintText = computed(() => t('{0} 保持网页或 PWA 窗口运行才能提醒。', permissionSummary.value))

function requestPermission() {
  if (context) void context.requestPermission()
  else emit('request')
}
</script>

<template>
  <div class="permission-hint" role="status">
    <span>{{ hintText }}</span>
    <button v-if="effectivePermission === 'default'" class="permission-hint-btn action-button is-quiet" type="button" @click="requestPermission">{{ t('允许系统通知') }}</button>
  </div>
</template>

<style scoped>
.permission-hint { color: var(--muted); font-size: var(--type-label); line-height: 1.6; }
</style>
