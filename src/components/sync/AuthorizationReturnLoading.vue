<script setup lang="ts">
import { t } from '../../i18n'
// 授权返回等待的分段提示；只表达进行中，不代替连接成功或失败后的原文。
import { authorizationReturnLoadingText, authorizationReturnSegmentCount } from '../../sync/authorizationReturnLoading'
</script>

<template>
  <p class="auth-return-loading inline-status tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-muted" role="status" aria-busy="true">
    <span class="auth-return-segments" aria-hidden="true">
      <span v-for="segment in authorizationReturnSegmentCount" :key="segment"></span>
    </span>
    {{ t(authorizationReturnLoadingText) }}
  </p>
</template>
