<script setup lang="ts">
import { languageOptions, locale, setLocale, t, feedbackText } from '../../i18n'
import { computed, shallowRef } from 'vue'
import type { UiTheme } from '../../storage/types'
import { followUpMinutesValue } from '../../storage/transform'
import { setSingleKeyShortcutsEnabled, singleKeyShortcutsEnabled } from '../../application/keyboardShortcutsPreference'
import SegmentedControl from '../ui/SegmentedControl.vue'
import NothingInput from '../ui/NothingInput.vue'
import AppIcon from '../ui/AppIcon.vue'
import OfflineReadinessPanel from './OfflineReadinessPanel.vue'
import DeviceConnectionPanel from '../sync/DeviceConnectionPanel.vue'
import { useDeviceConnection } from '../../composables/useDeviceConnection'
import { useCloudSync } from '../../composables/workspaceContexts'
import SharedRestorePanel from '../sync/SharedRestorePanel.vue'
import DeviceSyncPanel from '../sync/DeviceSyncPanel.vue'

const { connected, unreadable } = useDeviceConnection()
const { sync } = useCloudSync()
defineSlots<{ dataBackup(): unknown; categories(): unknown }>()
defineProps<{
  showCloud?: boolean
  uiTheme: UiTheme
  categoryCount: number
  defaultFollowUpMinutes: number
  isSaving: boolean
  isDatabaseReady: boolean
}>()

const emit = defineEmits<{
  'update-default-follow-up': [minutes: number]
  'update-theme': [theme: UiTheme]
}>()

const themeOptions = computed<ReadonlyArray<{ value: UiTheme; label: string }>>(() => [
  { value: 'dark', label: t('DARK') },
  { value: 'light', label: t('LIGHT') },
  { value: 'system', label: t('SYSTEM') },
])
const shortcutOptions = computed<ReadonlyArray<{ value: 'on' | 'off'; label: string }>>(() => [
  { value: 'on', label: t('开启') },
  { value: 'off', label: t('关闭') },
])
const connectionSummaryLabel = computed(() => unreadable.value ? t('需要重新连接') : connected.value ? t('已连接') : t('未连接'))

const defaultFollowUpDraft = shallowRef<string | number | null>(null)
const defaultFollowUpError = shallowRef('')

function updateDefaultFollowUp(value: string | number) {
  const minutes = followUpMinutesValue(Number(value))
  defaultFollowUpError.value = minutes === null ? t('请输入 5–1440 分钟的整数，尚未保存') : ''
  if (minutes !== null) { defaultFollowUpDraft.value = null; emit('update-default-follow-up', minutes) }
}
</script>

<template>
  <section class="settings-view tw:relative tw:pt-lg tw:ge-1041:w-[min(100%,clamp(50vw,880px,70vw))] tw:ge-1041:mx-auto" :aria-label="t('设置')">
    <div class="settings-preferences">
      <section class="settings-panel tw:max-w-none" aria-labelledby="language-settings-title">
        <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-xs">
          <h2 id="language-settings-title" class="settings-icon-label tw:shrink-0 tw:text-text-display tw:text-body tw:font-normal tw:leading-[1.2]">
            <AppIcon name="language" />
            <span>{{ t('语言') }}</span>
          </h2>
          <SegmentedControl
            class="tw:ms-auto"
            :model-value="locale"
            :options="languageOptions"
            :label="t('界面语言')"
            size="compact"
            @update:model-value="setLocale"
          />
        </div>
      </section>

      <section class="settings-panel tw:max-w-none tw:mt-sm" aria-labelledby="theme-settings-title">
        <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-xs">
          <h2 id="theme-settings-title" class="settings-icon-label tw:shrink-0 tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">
            <AppIcon name="theme" />
            <span>{{ t('主题') }}</span>
          </h2>
          <SegmentedControl
            class="tw:ms-auto"
            :model-value="uiTheme"
            :options="themeOptions"
            :label="t('界面主题')"
            size="compact"
            @update:model-value="emit('update-theme', $event)"
          />
        </div>
        <p class="settings-note settings-icon-note tw:text-dim tw:leading-[1.5] tw:text-label tw:mt-xs tw:mb-sm">{{ t('SYSTEM 跟随系统的深浅色设置；主题保存在本地数据中，随导出文件迁移。') }}</p>
      </section>

      <section class="settings-panel tw:max-w-none tw:mt-sm" aria-labelledby="shortcuts-settings-title">
        <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-xs">
          <h2 id="shortcuts-settings-title" class="tw:shrink-0 tw:text-text-display tw:text-body tw:font-normal tw:leading-[1.2]">
            {{ t('单键快捷键') }}
          </h2>
          <SegmentedControl
            class="tw:ms-auto"
            :model-value="singleKeyShortcutsEnabled ? 'on' : 'off'"
            :options="shortcutOptions"
            :label="t('单键快捷键')"
            size="compact"
            @update:model-value="setSingleKeyShortcutsEnabled($event === 'on')"
          />
        </div>
        <p class="settings-note tw:text-dim tw:leading-[1.5] tw:text-label tw:mt-xs tw:mb-0">{{ t('关闭后，单字符快捷键（/、N、X）将不响应，避免与语音输入或辅助工具冲突；方向键、Esc 与 Ctrl/Cmd+S 仍可使用。') }}</p>
      </section>
    </div>

    <details class="settings-group">
      <summary class="settings-group-summary settings-icon-label">
        <AppIcon name="reminders" />
        <h2 class="settings-group-title">{{ t('本机提醒') }}</h2>
        <AppIcon name="disclosure" class="settings-group-chevron" />
      </summary>
      <section class="settings-panel settings-group-section tw:max-w-none tw:mt-section" aria-labelledby="reminder-settings-title">
        <div class="section-heading compact-heading tw:mb-md tw:flex tw:justify-between tw:items-start tw:gap-md">
          <div>
            <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm">{{ t('REMINDERS') }}</span>
            <h3 id="reminder-settings-title" class="tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">{{ t('追提醒间隔') }}</h3>
          </div>
        </div>
        <div class="field tw:grid tw:gap-xs tw:mb-md">
          <NothingInput :model-value="defaultFollowUpDraft ?? defaultFollowUpMinutes" @update:model-value="defaultFollowUpDraft = $event; defaultFollowUpError = ''" :label="t('全局追提醒间隔（分钟）')" :show-label="true" type="number" min="5" max="1440" step="5" :placeholder="t('例如：30')" :error="feedbackText(defaultFollowUpError)" :disabled="!isDatabaseReady || isSaving" @change="updateDefaultFollowUp" :help="t('5–1440 分钟，修改后自动保存。分类可覆盖全局间隔，单条任务可再单独设置；恢复跟随后使用上级间隔。')" />
        </div>
      </section>
    </details>

    <details class="settings-group">
      <summary class="settings-group-summary settings-icon-label">
        <AppIcon name="backup" />
        <h2 class="settings-group-title">{{ t('数据与备份') }}</h2>
        <AppIcon name="disclosure" class="settings-group-chevron" />
      </summary>
      <slot name="dataBackup" />
    </details>

    <details class="settings-group">
      <summary class="settings-group-summary settings-icon-label">
        <AppIcon name="offline" />
        <h2 class="settings-group-title">{{ t('离线启动') }}</h2>
        <AppIcon name="disclosure" class="settings-group-chevron" />
      </summary>
      <OfflineReadinessPanel embedded />
    </details>

    <details class="settings-group" :open="showCloud">
      <summary class="settings-group-summary settings-icon-label">
        <AppIcon name="cloud" />
        <h2 class="settings-group-title">{{ t('网盘同步') }}</h2>
        <span class="tw:font-data tw:text-dim tw:text-label">{{ connectionSummaryLabel }}</span>
        <AppIcon name="disclosure" class="settings-group-chevron" />
      </summary>
      <DeviceConnectionPanel class="settings-group-section" />
      <DeviceSyncPanel v-if="sync.scope" class="settings-group-section" />
      <SharedRestorePanel v-if="sync.scope" />
    </details>

    <details class="settings-group">
      <summary class="settings-group-summary settings-icon-label">
        <AppIcon name="categories" />
        <h2 class="settings-group-title">{{ t('分类、完成策略与追提醒') }}</h2>
        <span class="tw:font-data tw:text-dim tw:text-label">{{ t('{0} 个分类', categoryCount) }}</span>
        <AppIcon name="disclosure" class="settings-group-chevron" />
      </summary>
      <slot name="categories" />
    </details>
  </section>
</template>

<style scoped>
.settings-preferences { padding-bottom: var(--space-md); margin-bottom: var(--space-xs); border-bottom: 1px solid var(--line); }
.settings-group { padding: 0 0 8px; border-bottom: 1px solid var(--line); }
.settings-group-summary { padding: 14px 0; min-height: 44px; cursor: pointer; color: var(--text-display); font-size: var(--type-body); list-style: none; }
.settings-group-summary::-webkit-details-marker { display: none; }
.settings-group-title { flex: 1; min-width: 0; margin: 0; font: inherit; }
.settings-group-chevron { flex: 0 0 16px; width: 16px; height: 16px; }
.settings-group[open] > .settings-group-summary > .settings-group-chevron { transform: rotate(90deg); }
.settings-group[open] { padding-bottom: 20px; }
.settings-group-section, .settings-group > :slotted(.settings-panel) { margin-top: 12px; }

@media (prefers-reduced-motion: no-preference) {
  .settings-group {
    --settings-motion-duration: var(--motion-base);
    --settings-motion-easing: var(--ease-out);
  }

  @supports (transition-timing-function: linear(0, 1)) {
    .settings-group {
      --settings-motion-duration: 460ms;
      /* Sampled from createUnderdampedSpring(420, 35, 1) at rest, over 460 ms. */
      --settings-motion-easing: linear(
        0, 0.00922 1.5%, 0.03404 3%, 0.07067 4.5%, 0.11591 6%, 0.18514 8%,
        0.33668 12%, 0.44915 15%, 0.51974 17%, 0.58544 19%, 0.64562 21%,
        0.69998 23%, 0.74846 25%, 0.79121 27%, 0.84525 30%, 0.88834 33%,
        0.93133 37%, 0.96102 41%, 0.98432 46%, 0.99874 52%, 1.00492 59%,
        1.00577 64%, 1.00406 75%, 1.00174 87%, 1
      );
    }
  }

  .settings-group-chevron { transition: transform var(--settings-motion-duration) var(--settings-motion-easing); }

  @supports selector(::details-content) and (interpolate-size: allow-keywords) and (transition-behavior: allow-discrete) {
    .settings-group { transition: padding-bottom var(--settings-motion-duration) var(--settings-motion-easing); }

    .settings-group::details-content {
      /* Keep margins inside the animated box without trapping open dropdowns. */
      display: flow-root;
      interpolate-size: allow-keywords;
      block-size: 0;
      overflow-y: clip;
      --settings-overflow-ease: step-start;
      transition:
        block-size var(--settings-motion-duration) var(--settings-motion-easing),
        content-visibility var(--settings-motion-duration) allow-discrete,
        overflow-y var(--settings-motion-duration) var(--settings-overflow-ease) allow-discrete;
    }

    .settings-group[open]::details-content {
      block-size: auto;
      overflow-y: visible;
      --settings-overflow-ease: step-end;
    }
  }
}
</style>
