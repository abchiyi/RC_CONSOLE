/**
 * main.ts
 *
 * Bootstraps Vuetify, Pinia, Router then mounts the App
 */

// Plugins
import { registerPlugins } from '@/plugins'

// Components
import App from './App.vue'

// Composables
import { createApp } from 'vue'

// Pinia
import { createPinia } from 'pinia'

// Stores (import definition at top, usage after pinia install)
import { useChannelStore } from '@/stores/channels'
import { useConfigStore } from '@/stores/config'

// Serial
import { serialService } from '@/services/SerialService'

// Styles
import 'unfonts.css'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

// 注册串口 JSON 响应路由
// 回调在 pinia 安装后才收到数据，调用 useStore 安全
serialService.onLine((line: string) => {
  // 串口是日志+数据二合一通道，非 JSON 行已在 SerialService 中过滤
  // 固件响应不含 cmd 字段，通过 JSON shape 区分响应类型
  try {
    const json = JSON.parse(line)

    // get_channels → 通道 Store（channels 为数组成员）
    if (Array.isArray(json.channels)
        && json.channels.length > 0
        && typeof json.channels[0] === 'number') {
      useChannelStore().update({
        channels: json.channels,
        sources: json.sources ?? [],
      })
    }

    // get_info / get_config / get_model → 配置 Store
    // get_model 的 channels 是对象数组，与 get_channels 区分
    if (
      json.device !== undefined
      || json.models !== undefined
      || (json.channel_count !== undefined && json.input_sources)
      || (Array.isArray(json.channels) && json.channels.length > 0
          && typeof json.channels[0] === 'object')
    ) {
      useConfigStore().handleResponse(json as Record<string, unknown>)
    }
  } catch {
    // 忽略解析失败（日志背景噪音或截断数据）
  }
})

registerPlugins(app)

app.mount('#app')
