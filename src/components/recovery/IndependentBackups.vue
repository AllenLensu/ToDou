<script setup lang="ts">
import { getLocale, t } from '../../i18n'
import { syncFeedbackText } from '../../sync/connectionFeedback'
import { computed, shallowRef, watch } from 'vue'
import NothingInput from '../ui/NothingInput.vue'
import type { BackupControls } from '../../composables/useIndependentBackups'
import type { BackupDestination, BackupLocation } from '../../storage/independentBackups'

const props = defineProps<{ backups: BackupControls; disabled: boolean }>()
const emit = defineEmits<{ preview: [file: File] }>()
const connectedFolder = computed(() => props.backups.connectedFolder.value)
const schedule = computed(() => props.backups.schedule.value)
const busy = computed(() => props.backups.busy.value)
const message = computed(() => props.backups.message.value)
const retry = computed(() => props.backups.retry.value)
const listing = computed(() => props.backups.listing.value)
const listingPlace = computed(() => props.backups.listingPlace.value)

const folder = shallowRef(connectedFolder.value)
const username = shallowRef('')
const password = shallowRef('')
const minutes = shallowRef<number | string>(schedule.value.minutes)
const destination = shallowRef<BackupDestination>(schedule.value.destination)
const deletion = shallowRef('')
const placeLabel = (place: BackupLocation) => place === 'local' ? t('本机') : 'WebDAV'

watch(connectedFolder, (next) => { folder.value = next })
watch(schedule, (next) => {
  minutes.value = next.minutes
  destination.value = next.destination
})

async function connect() {
  await props.backups.connect(folder.value, username.value, password.value)
  password.value = ''
}
async function list(place: BackupLocation) {
  deletion.value = ''
  await props.backups.list(place)
}
</script>

<template>
  <div class="independent-backups">
    <h3 class="backup-heading">{{ t('独立备份') }}</h3>
    <fieldset class="backup-fieldset" :disabled="disabled || busy">
      <legend class="sr-only">{{ t('独立备份') }}</legend>
      <div class="actions">
        <button class="action-button" type="button" @click="backups.manual('local')">{{ t('备份到本机') }}</button>
        <button class="action-button" type="button" :disabled="!connectedFolder" @click="backups.manual('webdav')">{{ t('备份到 WebDAV') }}</button>
        <button class="action-button" type="button" :disabled="!connectedFolder" @click="backups.manual('both')">{{ t('两处都备份') }}</button>
      </div>
      <details class="backup-details">
        <summary class="disclosure-summary">{{ t('WebDAV 备份目录') }}</summary>
        <p class="backup-note">{{ t('此目录可与日常同步分开使用。账号和应用密码仅保存在本机。') }}</p>
        <p v-if="connectedFolder" class="backup-note">{{ t('已连接 {0}', connectedFolder) }}</p>
        <form class="backup-form" @submit.prevent="connect">
          <NothingInput v-model="folder" :label="t('备份目录地址')" show-label type="url" required placeholder="https://…" placeholder-mode="raw" />
          <NothingInput v-model="username" :label="t('账号')" show-label autocomplete="username" required />
          <NothingInput v-model="password" :label="t('应用密码')" show-label type="password" autocomplete="off" required />
          <div class="actions">
            <button class="action-button is-primary" type="submit">{{ t('验证并连接') }}</button>
            <button v-if="connectedFolder" class="action-button" type="button" @click="backups.disconnect()">{{ t('断开备份目录') }}</button>
          </div>
        </form>
      </details>
      <details class="backup-details">
        <summary class="disclosure-summary">{{ t('自动备份') }}</summary>
        <p class="backup-note">{{ t('应用打开时按本机设置的间隔备份。本机创建的自动备份在本机保留最近 3 份，在 WebDAV 保留最近 10 份。手动备份保留到主动删除。') }}</p>
        <form class="backup-form" @submit.prevent="backups.setSchedule(Number(minutes), destination)">
          <NothingInput v-model="minutes" :label="t('间隔（分钟，0 表示关闭）')" show-label type="number" min="0" step="1" required />
          <NothingInput v-model="destination" kind="select" :label="t('位置')" show-label :disabled="disabled || busy">
            <option value="local">{{ t('本机') }}</option><option value="webdav">WebDAV</option><option value="both">{{ t('本机和 WebDAV') }}</option>
          </NothingInput>
          <div class="actions"><button class="action-button is-primary" type="submit">{{ t('保存自动备份设置') }}</button></div>
        </form>
      </details>
      <details class="backup-details">
        <summary class="disclosure-summary">{{ t('查看与恢复备份') }}</summary>
        <p class="backup-note">{{ t('本机备份存放在此应用的数据空间。换设备时可在另一台设备连接同一 WebDAV 备份目录，选择备份并预览恢复范围。') }}</p>
        <div class="actions">
          <button class="action-button" type="button" @click="list('local')">{{ t('查看本机备份') }}</button>
          <button class="action-button" type="button" :disabled="!connectedFolder" @click="list('webdav')">{{ t('查看 WebDAV 备份') }}</button>
        </div>
        <p v-if="listingPlace && !listing.length" class="backup-note">{{ t('{0}还没有独立备份。', placeLabel(listingPlace)) }}</p>
        <ul v-if="listingPlace && listing.length" class="backup-list" :aria-label="t('{0}备份列表', placeLabel(listingPlace))">
          <li v-for="row in listing" :key="row.name" class="backup-item">
            <span>{{ new Date(row.time).toLocaleString(getLocale()) }} · {{ row.kind === 'manual' ? t('手动') : t('自动') }}</span>
            <div v-if="deletion !== row.name" class="actions">
              <button class="action-button" type="button" @click="backups.preview(listingPlace, row.name, file => emit('preview', file))">{{ t('预览恢复') }}</button>
              <button class="action-button" type="button" @click="deletion = row.name">{{ t('删除备份') }}</button>
            </div>
            <div v-else class="actions">
              <button class="action-button" type="button" @click="deletion = ''">{{ t('保留备份') }}</button>
              <button class="action-button is-danger" type="button" @click="backups.remove(listingPlace, row.name)">{{ t('确认删除此份备份') }}</button>
            </div>
          </li>
        </ul>
      </details>
      <button v-if="retry" class="action-button" type="button" @click="backups.repeat()">{{ t('重试未完成的位置') }}</button>
    </fieldset>
    <p v-if="busy || message" class="backup-note" role="status">{{ busy ? t('正在处理备份…') : syncFeedbackText(message) }}</p>
  </div>
</template>

<style scoped>
.independent-backups { display: grid; gap: 12px; margin-block: 20px; }
.backup-heading { color: var(--text-display); font-weight: 500; }
.backup-fieldset, .backup-form, .backup-list { display: grid; gap: 12px; min-width: 0; padding: 0; margin: 0; border: 0; }
.backup-details { border-top: 1px solid var(--line); }
.backup-note { color: var(--muted); font-size: var(--type-label); overflow-wrap: anywhere; margin: 4px 0 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.backup-item { display: grid; gap: 6px; padding-block: 8px; border-bottom: 1px solid var(--line); }
</style>
