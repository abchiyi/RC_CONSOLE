/**
 * themePreference.ts — 亮/暗主题偏好的读写与解析（纯函数，不依赖 Vue / Vuetify）
 *
 * 三段开关的三态与 Vuetify 的二态之间隔着一层解析：
 *   'light'  → light
 *   'dark'   → dark
 *   'system' → 取决于 prefers-color-scheme（本文件是唯一判定点）
 *
 * 之所以不把 'system' 直接丢给 Vuetify 的 defaultTheme：解析规则一旦分散，
 * 「首帧用什么色」和「切换后用什么色」就可能算出两个答案（MediaQuery 首帧延迟）。
 * 这里统一收敛：解析结果永远是具体的 'light' | 'dark'。
 */

/** 用户在 UI 上可选择的三种模式 */
export type ThemeMode = 'light' | 'system' | 'dark'

/** Vuetify 实际能接受的主题名（'system' 已被解析掉） */
export type ResolvedTheme = 'light' | 'dark'

/** 偏好持久化键（与设备数据无关，故不受 resetAllStores 清理） */
export const THEME_STORAGE_KEY = 'rc-app:theme-mode'

const MODES = ['light', 'system', 'dark'] as const

/** 收窄外部输入（localStorage 内容、v-btn-toggle 回传的 any） */
export function isThemeMode (v: unknown): v is ThemeMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

/** 读取持久化偏好；无记录或内容非法 → 跟随系统 */
export function readThemeMode (): ThemeMode {
  const raw = localStorage.getItem(THEME_STORAGE_KEY)
  return isThemeMode(raw) ? raw : 'system'
}

/** 写入持久化偏好（仅记录用户选择，不负责下发到 Vuetify） */
export function writeThemeMode (mode: ThemeMode): void {
  localStorage.setItem(THEME_STORAGE_KEY, mode)
}

/** 系统当前是否偏好暗色 */
export function prefersDark (): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 三态 → Vuetify 二态 */
export function resolveThemeName (mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode
}
