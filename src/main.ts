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
  bleService,
} from '@/services/SerialService'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

/**
 * 串口/BLE 二进制帧响应路由
 * 各后端已把二进制帧解码为对象（响应带 cmd 字段、事件带 evt 字段），这里只做路由。
 * 回调在 pinia 安装后才收到数据，调用 useStore 安全
 */
function routeObject(obj: Record<string, unknown>): void {
  // 流式事件（STREAM_START 后固件定时推送）
  if (obj.evt === 0x0001) {
    routeStreamEvent(Number(obj.contentType), obj.data as Record<string, unknown>)
    return
  }

  const cmd = obj.cmd as string | undefined
  if (!cmd) return

  // get_link_stats / elrs_list_fields / elrs_set_param → 链路统计 Store
  if (cmd === 'get_link_stats') {
    useLinkStatsStore().update(obj)
    return
  }
  if (cmd === 'elrs_list_fields' || cmd === 'elrs_set_param' ||
      cmd === 'elrs_rescan_fields' ||
      cmd === 'elrs_wifi_start' || cmd === 'elrs_wifi_stop' ||
      cmd === 'elrs_ble_start' || cmd === 'elrs_ble_stop' ||
      cmd === 'elrs_bind_start') {
    useLinkStatsStore().handleElrsResponse(obj)
    return
  }

  // cal_* → 校准 Store（通道/raw+IMU 已并入流式推送）
  if (cmd.startsWith('cal_')) {
    useCalibrationStore().handleResponse(obj)
    return
  }

  // get_power_cfg / set_power_cfg / get_power_state / set_debug_mode / get_debug_mode → 电源 Store
  if (cmd.includes('power') || cmd.includes('debug')) {
    usePowerStore().handleResponse(obj)
    return
  }

  // get_info / get_config / get_model / set_model / set_active / save / load / reset → 配置 Store
  useConfigStore().handleResponse(obj)
}

/** 流式事件路由（STREAM content_type：0=通道 1=raw+IMU 2=电源 3=链路） */
function routeStreamEvent(contentType: number, data: Record<string, unknown>): void {
  switch (contentType) {
    case 0: {
      const channels = data.channels as number[] | undefined
      if (Array.isArray(channels)) {
        useChannelStore().update({
          channels,
          sources: (data.sources as string[] | undefined) ?? [],
        })
      }
      break
    }
    case 1:
      // 实时 raw+IMU（校准页流式数据）
      useCalibrationStore().applyCalRaw(data)
      break
    case 2:
      usePowerStore().handleResponse(data)
      break
    case 3:
      useLinkStatsStore().update(data)
      break
    default:
      break
  }
}

// 注册对象路由到全部后端实例。
// 注意：setSerialBackend() 只替换 serialService 引用、不迁移 onObject 监听器，
// 因此必须对每个后端单独注册，否则切换到 BLE 后收到的 notify 数据无人消费。
;[webSerialService, electronSerialService, bleService]
  .forEach(svc => svc.onObject(routeObject))
// 活动后端引用兜底（若未来新增后端实例未在上面枚举）
serialService.onObject(routeObject)

registerPlugins(app)

app.mount('#app')
