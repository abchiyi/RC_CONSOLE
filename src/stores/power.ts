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
  battery_pct: number
}

export const usePowerStore = defineStore('power', () => {
  const cfg = ref<PowerCfg>({ idle_warning_s: 300, idle_shutdown_s: 360 })
  const state = ref<PowerState | null>(null)
  const debugMode = ref(false)
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
    try { await p } catch (e) { error.value = (e as Error).message }
    loading.value = false
  }

  async function fetchState(): Promise<void> {
    const p = rr.wait('get_power_state', 2000)
    await serialService.sendCommand('get_power_state')
    try { await p } catch { /* 轮询超时不报错 */ }
  }

  async function setDebugMode(enable: boolean): Promise<void> {
    const p = rr.wait('set_debug_mode')
    await serialService.sendCommand('set_debug_mode', { enable })
    try { await p } catch (e) { error.value = (e as Error).message }
  }

  async function fetchDebugMode(): Promise<void> {
    const p = rr.wait('get_debug_mode')
    await serialService.sendCommand('get_debug_mode')
    try { await p } catch (e) { error.value = (e as Error).message }
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
      if (typeof json.debug_mode === 'boolean') {
        debugMode.value = json.debug_mode
      }
      rr.tryResolve('get_power_state')
      return
    }

    // get_debug_mode / set_debug_mode 响应
    if (typeof json.debug_mode === 'boolean') {
      debugMode.value = json.debug_mode
      rr.tryResolve('get_debug_mode')
      rr.tryResolve('set_debug_mode')
      return
    }
  }

  return {
    cfg,
    state,
    debugMode,
    loading,
    error,
    fetchCfg,
    saveCfg,
    fetchState,
    setDebugMode,
    fetchDebugMode,
    handleResponse,
  }
})
