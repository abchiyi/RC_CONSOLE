import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { prefersDark, readThemeMode, type ResolvedTheme, type ThemeMode, writeThemeMode } from '@/utils/themePreference'

/**
 * stores/theme.ts — 界面亮/暗偏好
 *
 * 与其余 store 的区别：这里装的是**用户偏好**而不是设备状态，因此
 *   - 不进 resetAll.ts（断开连接不重置：UI 偏好应跨会话保留，清掉反而像 bug）
 *   - 不直接碰 Vuetify（store 保持在组件上下文之外可用；下发统一由 App.vue 的
 *     watchEffect 做，保证「切换只有一个写点」）
 *
 * 数据流：
 *   ThemeModeToggle 点击 → setMode() → mode → localStorage（watch 落盘）
 *                                    ↘ effective（含系统偏好）→ App.vue → theme.global.name
 */

export const useThemeStore = defineStore('theme', () => {
  /** 用户选择的三态 */
  const mode = ref<ThemeMode>(readThemeMode())

  /** 系统偏好快照：mode === 'system' 时由它驱动实际外观 */
  const systemDark = ref(prefersDark())

  // 常驻监听：用户切了系统主题，正在运行的 app 要立刻跟上（不要求重开）
  const mql = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
  mql?.addEventListener('change', e => {
    systemDark.value = e.matches
  })

  /** 真正生效的 Vuetify 主题名 —— App.vue 唯一消费这个值 */
  const effective = computed<ResolvedTheme>(() =>
    mode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : mode.value)

  /** 落盘：只记用户选择，不记解析结果（否则切系统主题会污染"跟随系统"这一档） */
  watch(mode, m => writeThemeMode(m))

  function setMode (m: ThemeMode): void {
    mode.value = m
  }

  return { mode, effective, setMode }
})
