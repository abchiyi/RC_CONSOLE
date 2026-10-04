/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@/styles/mdi-subset.css'
import 'vuetify/styles'
import '@/styles/buttons.css'
import '@/styles/selects.css'
import '@/styles/switches.css'
import '@/styles/snackbars.css'

// Composables
import { createVuetify } from 'vuetify'
import { readThemeMode, resolveThemeName } from '@/utils/themePreference'

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides

/** Betaflight 品牌琥珀黄 (master.app.betaflight.com 主题色) */
const bfOrange = '#FFBB00'

export default createVuetify({
  // 全站 v-switch 统一样式: 紧凑尺寸 + 隐藏详情 + 内嵌布局 + 默认主色
  // (各页仅在需要语义色时显式传 color; 视觉规范见 styles/switches.css)
  defaults: {
    VSwitch: {
      color: 'primary',
      density: 'compact',
      hideDetails: true,
      inset: true,
    },
  },
  theme: {
    // 启动首帧就用本地偏好解析出的具体主题(light/dark)，不再写死 'system'：
    // 'system' 交给 Vuetify 解析会在 MediaQuery 可用前先出一帧错色。
    // 运行期切换由 stores/theme.ts 接管（唯一写点见 App.vue 的 watchEffect）。
    defaultTheme: resolveThemeName(readThemeMode()),
    themes: {
      light: {
        dark: false,
        colors: {
          primary: bfOrange,
          secondary: '#546e7a',   // 蓝灰辅助
          accent: '#ffc107',      // 亮琥珀高亮
          error: '#e53935',
          info: '#2196f3',
          success: '#2e7d32',
          warning: '#ef6c00',
          background: '#fafafa',
          surface: '#ffffff',
          'on-primary': '#1a1a1a', // 橙色上深色文字 (保证对比度)
          bluetooth: '#477AC7',   // 蓝牙主题蓝
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: bfOrange,
          secondary: '#90a4ae',
          accent: '#ffc107',
          error: '#ef5350',
          info: '#4fc3f7',
          success: '#81c784',
          warning: '#ffb300',
          background: '#121212',
          surface: '#1e1e1e',
          'surface-variant': '#252525',
          'on-surface-variant': '#e0e0e0', // 显式补齐: 亮色取默认 #EEEEEE, 暗色需与 #252525 深底配对
          'on-primary': '#1a1a1a',
          bluetooth: '#477AC7',   // 蓝牙主题蓝
        },
      },
    },
  },
})
