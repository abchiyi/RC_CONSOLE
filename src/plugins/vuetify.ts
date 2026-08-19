/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@/styles/mdi-subset.css'
import '@/styles/selects.css'
import 'vuetify/styles'

// Composables
import { createVuetify } from 'vuetify'

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides

/** Betaflight 品牌琥珀黄 (master.app.betaflight.com 主题色) */
const bfOrange = '#FFBB00'

export default createVuetify({
  theme: {
    defaultTheme: 'system',
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
          'on-primary': '#1a1a1a',
          bluetooth: '#477AC7',   // 蓝牙主题蓝
        },
      },
    },
  },
})
