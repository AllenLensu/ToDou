<script setup lang="ts">
import { Bell, ChevronRight, Cloud, DatabaseBackup, HardDriveDownload, Languages, ListChecks, Palette, Plus, Search, Settings, Tags, Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/vue'

const icons = {
  new: Plus,
  search: Search,
  tasks: ListChecks,
  settings: Settings,
  trash: Trash2,
  offline: HardDriveDownload,
  language: Languages,
  theme: Palette,
  reminders: Bell,
  backup: DatabaseBackup,
  cloud: Cloud,
  categories: Tags,
  disclosure: ChevronRight,
}
defineProps<{ name: keyof typeof icons }>()
</script>

<template>
  <MorphIcon
    :icon="icons[name]" :size="20" :stroke-width="1.5" absolute-stroke-width
    reduced-motion="always" aria-hidden="true" focusable="false"
  />
</template>
