<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { t } from '../../i18n'
import { offlineReadiness } from '../../application/offlineReadiness'
import AppIcon from '../ui/AppIcon.vue'

defineProps<{ embedded?: boolean }>()

const { currentVersion, candidateVersion, environment, downloading, retrying, failure, retry, verify } = offlineReadiness
onMounted(() => { if (environment === 'supported') void verify() })

const summary = computed(() => {
  if (environment === 'development') return t('开发模式未启用离线缓存。')
  if (environment === 'unsupported') return t('当前浏览器环境不支持离线启动。')
  if (currentVersion.value) return t('已可离线打开，构建 {0}。', currentVersion.value)
  if (failure.value) return t('尚未确认可离线打开。')
  return downloading.value ? t('正在下载首次离线启动所需的资源。') : t('正在检查离线启动所需的资源。')
})

const detail = computed(() => {
  switch (failure.value) {
    case 'register': return t('离线服务注册失败。')
    case 'install': return currentVersion.value ? t('更新下载失败，当前离线版本仍可使用。') : t('首次离线缓存下载失败。')
    case 'activate': return t('新构建未能激活。')
    case 'update': return t('检查更新失败。')
    case 'incomplete': return t('当前离线缓存缺少必需资源。')
    case 'verify': return t('未收到完整的缓存检查结果。')
  }
  return downloading.value && currentVersion.value ? t('正在下载更新。') : ''
})
</script>

<template>
  <section class="settings-panel" :class="embedded ? 'settings-group-section' : 'tw:mt-sm'" :aria-labelledby="embedded ? undefined : 'offline-settings-title'">
    <h2 v-if="!embedded" id="offline-settings-title" class="settings-icon-label tw:text-text-display tw:text-body tw:font-normal">
      <AppIcon name="offline" />
      <span>{{ t('离线启动') }}</span>
    </h2>
    <div role="status" class="settings-note tw:text-dim tw:text-label tw:leading-[1.5]" :class="embedded ? '' : 'settings-icon-note tw:mt-xs'">
      <p>{{ summary }}</p>
      <p v-if="detail">{{ detail }}</p>
      <p v-if="candidateVersion">{{ t('下载的构建：{0}', candidateVersion) }}</p>
    </div>
    <button v-if="failure || retrying" type="button" class="action-button tw:my-xs" :class="embedded ? '' : 'settings-icon-note'" :disabled="retrying || downloading" @click="retry">{{ t('重试离线缓存') }}</button>
  </section>
</template>
