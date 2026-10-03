/**
 * 电源管理 Store
 * 空闲关机配置 + 实时状态轮询
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { serialService } from '@/services/SerialService'
import { RequestResponseHandler } from '@/utils/requestResponse'

export interface PowerCfg {
  idle_warning_s: number
  idle_shutdown_s: number
}

export interface PowerState {
  state: 'normal' | 'warning' | 'shutdown'
  charge: 'none' | 'charging' | 'full'
  idle_s: number
  battery_mv: number
  /** 电量档位 0~4 (0=空 4=满, 每档约 20% 容量); 固件不再上报百分比 */
  battery_level: number
  vbus_mv: number
  sys_mv: number
  temp: number
  charge_current_ma: number
  irq_count: number
  /** 最近命中过的空闲活动源位掩码 (固件 ActivitySrc, 3s 有效期) */
  activity_src: number
  vbus_type: number
  idpm_limit_ma: number
}

export const usePowerStore = defineStore('power', () => {
  const cfg = ref<PowerCfg>({ idle_warning_s: 300, idle_shutdown_s: 360 })
  const state = ref<PowerState | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const rr = new RequestResponseHandler()

  async function fetchCfg(): Promise<void> {
    loading.value = true
    error.value = null
    const p = rr.wait('get_power_cfg')
    await serialService.sendCommand('get_power_cfg')
    try { await p } catch (e) { error.value = (e as Error).message }
    loading.value = false
  }

  async function saveCfg(data: PowerCfg): Promise<void> {
    loading.value = true
    error.value = null
    const p = rr.wait('set_power_cfg')
    await serialService.sendCommand('set_power_cfg', data as unknown as Record<string, unknown>)
    try {
      await p
      // 保存成功后必须同步本地 cfg: 倒计时(remainS)/告警分档/idleDisabled 全都读
      // cfg, 不更新的话 UI 会继续按旧阈值倒数 —— 观感即"修改关机倒计时不重置"
      // (固件侧 power_idle_set_config 保存成功时已重置空闲计时, 设备行为本来就对)。
      cfg.value = { ...data }
      // 再拉一次设备真值校准: 固件会钳制/改写参数 (warn>=shut 拒绝、shut=0 强制
      // warn=0), 本地镜像可能与实际生效值有出入; system.vue 的 watch 会随之把
      // 表单草稿拉回设备真值。
      await fetchCfg()
    } catch (e) { error.value = (e as Error).message }
    loading.value = false
  }

  async function fetchState(): Promise<void> {
    const p = rr.wait('get_power_state', 2000)
    await serialService.sendCommand('get_power_state')
    try { await p } catch { /* 轮询超时不报错 */ }
  }

  function handleResponse(json: Record<string, unknown>): void {
    // get_power_cfg 响应
    if (typeof json.idle_warning_s === 'number' && typeof json.idle_shutdown_s === 'number') {
      cfg.value = json as unknown as PowerCfg
      rr.tryResolve('get_power_cfg')
      return
    }

    // set_power_cfg 响应 { ok: true }
    if (json.ok === true) {
      rr.tryResolve('set_power_cfg')
      return
    }

    // get_power_state 响应
    if (typeof json.state === 'string' && typeof json.idle_s === 'number') {
      state.value = json as unknown as PowerState
      rr.tryResolve('get_power_state')
      return
    }
  }

  /**
   * 断开场景：丢掉实时电源状态与配置镜像。
   * 下次连接由页面 onMounted 重新拉取，避免拿上一台设备的电量/阈值渲染新会话。
   */
  function reset (): void {
    cfg.value = { idle_warning_s: 300, idle_shutdown_s: 360 }
    state.value = null
    loading.value = false
    error.value = null
  }

  return {
    cfg,
    state,
    loading,
    error,
    fetchCfg,
    saveCfg,
    fetchState,
    handleResponse,
    reset,
  }
})
