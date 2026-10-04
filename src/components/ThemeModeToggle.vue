<template>
  <v-btn-toggle
    class="theme-toggle"
    color="primary"
    density="compact"
    divided
    mandatory
    :model-value="themeStore.mode"
    rounded="lg"
    variant="outlined"
    @update:model-value="onSelect"
  >
    <v-tooltip v-for="o in OPTIONS" :key="o.value" location="bottom" :text="o.label">
      <template #activator="{ props }">
        <v-btn v-bind="props" :icon="o.icon" size="small" :value="o.value" />
      </template>
    </v-tooltip>
  </v-btn-toggle>
</template>

<script setup lang="ts">
/**
 * ThemeModeToggle.vue — 亮 / 跟随系统 / 暗 三段开关
 *
 * 只负责「把用户选择写进 store」，不直接改 Vuetify：
 * 下发统一由 App.vue 的 watchEffect 完成，避免多处写 theme.global.name 打架。
 */
  import { useThemeStore } from '@/stores/theme'
  import { isThemeMode, type ThemeMode } from '@/utils/themePreference'

  const OPTIONS: { value: ThemeMode, icon: string, label: string }[] = [
    { value: 'light', icon: 'mdi-white-balance-sunny', label: '始终亮色' },
    { value: 'system', icon: 'mdi-laptop', label: '跟随系统' },
    { value: 'dark', icon: 'mdi-weather-night', label: '始终暗色' },
  ]

  const themeStore = useThemeStore()

  /** v-btn-toggle 回传的是 any —— 收窄后再入 store，避免非法值污染持久化偏好 */
  function onSelect (v: unknown): void {
    if (isThemeMode(v)) themeStore.setMode(v)
  }
</script>

<style scoped>
/* App bar 内压低存在感：只留一道细边框，选中段由 v-btn-toggle 上 primary 色 */
.theme-toggle {
  border-color: rgba(var(--v-theme-on-surface), 0.16);
}
</style>
