<script setup lang="ts">
import { t } from '../../i18n'
import { syncFeedbackText } from '../../sync/connectionFeedback'
// 管理本机网盘授权与目录读写探测；连接成功不等于启用待办同步，凭据由连接层留在本机。
import { computed, onMounted, shallowRef, watch } from 'vue'
import { refreshDeviceConnection, useDeviceConnection } from '../../composables/useDeviceConnection'
import { authorizationReturnPhase } from '../../sync/authorizationReturnLoading'
import AuthorizationReturnLoading from './AuthorizationReturnLoading.vue'
import NothingInput from '../ui/NothingInput.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { connected, unreadable, busy, message, failed, returnedToOneDrive, connectDav, connectDrive, check, disconnect } = useDeviceConnection()
const returnPhase = computed(() => authorizationReturnPhase(returnedToOneDrive.value, busy.value, message.value))
const provider = shallowRef<'webdav' | 'onedrive'>(connected.value?.kind ?? (returnedToOneDrive.value ? 'onedrive' : 'webdav'))
const providers = [
  { value: 'webdav', label: 'WebDAV' },
  { value: 'onedrive', label: 'OneDrive' },
] as const
const folder = shallowRef('')
const username = shallowRef('')
const password = shallowRef('')

// 切换服务或 WebDAV 连接成功后清除表单密码；失败时保留输入供用户修正重试。
watch(provider, () => { password.value = '' })
onMounted(() => {
  refreshDeviceConnection()
})

async function connect(event: SubmitEvent) {
  if (provider.value === 'onedrive') {
    const isOrganization = event.submitter instanceof HTMLButtonElement && event.submitter.value === 'organization'
    await connectDrive(isOrganization ? 'organization' : 'personal')
  } else if (await connectDav(folder.value.trim(), username.value.trim(), password.value)) {
    password.value = ''
  }
}
</script>

<template>
  <section class="settings-panel device-connection tw:max-w-[680px] tw:mt-section tw:[.settings-view_&]:max-w-none tw:[.settings-view_>&:first-child]:mt-0 tw:[&_p]:[overflow-wrap:anywhere]" aria-labelledby="device-connection-title">
    <div class="section-heading compact-heading tw:mb-md tw:flex tw:justify-between tw:items-start tw:gap-md">
      <h2 id="device-connection-title" class="tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">{{ t('网盘连接') }}</h2>
    </div>
    <template v-if="connected || unreadable">
      <p v-if="connected" class="settings-note tw:text-dim tw:leading-[1.5] tw:text-label tw:mt-[20px] tw:mx-0 tw:mb-sm">{{ connected.label }}</p>
      <div class="reminder-actions settings-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
        <button v-if="connected" class="button button-secondary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-surface-raised tw:active:border-text-display tw:active:text-text-display" type="button" :disabled="busy" @click="check">{{ t('重新验证') }}</button>
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" :disabled="busy" @click="disconnect">{{ t('断开本机连接') }}</button>
      </div>
    </template>
    <form v-else @submit.prevent="connect">
      <fieldset class="connection-fields tw:grid tw:gap-sm tw:min-w-0 tw:m-0 tw:p-0 tw:border-0" :disabled="busy">
      <legend class="sr-only">{{ t('网盘连接设置') }}</legend>
        <SegmentedControl v-model="provider" class="tw:justify-self-start" :label="t('网盘服务')" :options="providers" spring />
        <p class="settings-note tw:text-dim tw:leading-[1.5] tw:text-label tw:m-0">{{ t('验证时会在所选目录写入、读回并删除一个临时文件。授权只保存在这台设备。') }}</p>
        <template v-if="provider === 'webdav'">
          <NothingInput v-model="folder" :label="t('同步目录地址')" show-label type="url" required
            placeholder="https://dav.example.com/ToDou/" placeholder-mode="raw" autocomplete="url" />
          <NothingInput v-model="username" :label="t('账号')" show-label required autocomplete="username" />
          <NothingInput v-model="password" :label="t('应用密码')" show-label type="password" required autocomplete="current-password" />
        </template>
        <p v-else class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('登录后使用此账号的 ToDou 专属应用目录。') }}</p>
        <div class="reminder-actions settings-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
          <button v-if="provider === 'webdav'" class="button button-primary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" type="submit">{{ t('连接并验证') }}</button>
          <template v-else>
            <button class="button button-primary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" type="submit" value="personal">{{ t('登录个人 OneDrive') }}</button>
            <button class="button button-secondary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-surface-raised tw:active:border-text-display tw:active:text-text-display" type="submit" value="organization">{{ t('登录工作或学校 OneDrive') }}</button>
          </template>
        </div>
      </fieldset>
    </form>
    <AuthorizationReturnLoading v-if="returnPhase === 'loading'" />
    <p v-else-if="busy" class="inline-status tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-muted" role="status">{{ t('正在验证连接…') }}</p>
    <p v-else-if="message" class="inline-status tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-muted" :class="{ error: failed }" :role="failed ? 'alert' : 'status'">{{ syncFeedbackText(message) }}</p>
  </section>
</template>
