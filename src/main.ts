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
import { usePowerStore } from '@/stores/power'
import { useCalibrationStore } from '@/stores/calibration'
import { useLinkStatsStore } from '@/stores/linkStats'

// Serial (自动检测 Web/Electron 环境)
import {
  serialService,
  webSerialService,
  electronSerialService,
  webSocketService,
  bleService,
} from '@/services/SerialService'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

/**
 * 串口/BLE JSON 响应路由
 * 回调在 pinia 安装后才收到数据，调用 useStore 安全
 */
function routeJsonLine(line: string): void {
  // 通道是日志+数据二合一，非 JSON 行已在各后端中过滤
  // 固件响应统一携带 cmd 字段，通过 cmd 精确匹配路由
  try {
    const json = JSON.parse(line)
    const cmd = json.cmd as string | undefined
    if (!cmd) return

    // get_link_stats / elrs_list_fields / elrs_set_param → 链路统计 Store
    if (cmd === 'get_link_stats') {
      useLinkStatsStore().update(json as Record<string, unknown>)
      return
    }
    if (cmd === 'elrs_list_fields' || cmd === 'elrs_set_param') {
      useLinkStatsStore().handleElrsResponse(json as Record<string, unknown>)
      return
    }

    // get_channels → 通道 Store
    if (cmd === 'get_channels') {
      console.log('[Channels]', json.channels) // 调试：打印收到的通道数据
      useChannelStore().update({
        channels: json.channels,
        sources: json.sources ?? [],
      })
      return
    }

    // cal_* → 校准 Store
    if (cmd.startsWith('cal_')) {
      useCalibrationStore().handleResponse(json as Record<string, unknown>)
      return
    }

    // get_power_cfg / set_power_cfg / get_power_state / set_debug_mode / get_debug_mode → 电源 Store
    if (cmd.includes('power') || cmd.includes('debug')) {
      usePowerStore().handleResponse(json as Record<string, unknown>)
      return
    }

    // get_info / get_config / get_model / get_active / set_model / set_active / save / load / reset → 配置 Store
    useConfigStore().handleResponse(json as Record<string, unknown>)
  } catch {
    // 忽略解析失败（日志背景噪音或截断数据）
  }
}

// 注册 JSON 路由到全部后端实例。
// 注意：setSerialBackend() 只替换 serialService 引用、不迁移 onLine 监听器，
// 因此必须对每个后端单独注册，否则切换到 BLE 后收到的 notify 数据无人消费。
;[webSerialService, electronSerialService, webSocketService, bleService]
  .forEach(svc => svc.onLine(routeJsonLine))
// 活动后端引用兜底（若未来新增后端实例未在上面枚举）
serialService.onLine(routeJsonLine)

registerPlugins(app)

app.mount('#app')
