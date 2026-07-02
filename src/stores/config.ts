/**
 * 配置/模型管理 Store
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'
import { RequestResponseHandler } from '@/utils/requestResponse'

export interface InputSourceInfo {
  id: string
  is_button: boolean
}

export interface DeviceInfo {
  device: string
  model_count: number
  channel_count: number
  input_sources: InputSourceInfo[]
  button_triggers: string[]
}

export interface ModelChannel {
  source: string
  activate: {
    trigger: string
    value: number
  }
  deactivate: {
    trigger: string
    value: number
  }
  toggle: {
    trigger: string
    value: number
  }
  input_min: number
  input_center: number
  input_max: number
  output_min: number
  output_center: number
  output_max: number
  deadzone: number
  ec11_step: number
  reverse: boolean
}

export interface ModelConfig {
  name: string
  channels: ModelChannel[]
}

export interface AppConfig {
  radio_mode: number
  active_model: number
  lpf_alpha: number
  models: ModelConfig[]
}

export const useConfigStore = defineStore('config', () => {
  const deviceInfo = ref<DeviceInfo | null>(null)
  const config = ref<AppConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const rr = new RequestResponseHandler()
  let _pendingModelSlot: number | null = null

  const activeModelIndex = computed(() => config.value?.active_model ?? 0)
  const modelCount = computed(() => config.value?.models?.length ?? 0)

  const activeModel = computed(() =>
    config.value?.models?.[config.value.active_model] ?? null,
  )

  async function fetchDeviceInfo(): Promise<void> {
    loading.value = true
    error.value = null
    const promise = rr.wait('get_info')
    await serialService.sendCommand('get_info')
    try {
      await promise
    } catch (e) {
      error.value = (e as Error).message
    }
    loading.value = false
  }

  async function fetchConfig(): Promise<void> {
    loading.value = true
    error.value = null
    const promise = rr.wait('get_config')
    await serialService.sendCommand('get_config')
    try {
      await promise
    } catch (e) {
      error.value = (e as Error).message
    }
    loading.value = false
  }

  // 逐个拉取所有模型（避免大数据截断）
  async function fetchAllModels(activeSlot?: number): Promise<void> {
    const count = deviceInfo.value?.model_count ?? 0
    if (count === 0) return

    loading.value = true
    error.value = null

    // 初始化 config，占位 models 数组
    config.value = {
      radio_mode: 0,
      active_model: activeSlot ?? 0,
      lpf_alpha: 0,
      models: new Array(count).fill(null).map(() => ({ name: '', channels: [] })),
    }

    for (let slot = 0; slot < count; slot++) {
      const tag = `get_model_${slot}`
      const p = rr.wait(tag, 2000)
      _pendingModelSlot = slot
      await serialService.sendCommand('get_model', { slot })
      try {
        await p
      } catch {
        console.warn(`[Config] model ${slot} 超时`)
      }
    }

    _pendingModelSlot = null
    loading.value = false
  }

  async function fetchModel(slot: number): Promise<void> {
    loading.value = true
    const tag = `get_model_${slot}`
    const p = rr.wait(tag, 2000)
    _pendingModelSlot = slot
    await serialService.sendCommand('get_model', { slot })
    try {
      await p
    } catch {
      console.warn(`[Config] model ${slot} 超时`)
    }
    _pendingModelSlot = null
    loading.value = false
  }

  async function setActiveModel(slot: number): Promise<void> {
    await serialService.sendCommand('set_active', { slot })
  }

  async function setModel(slot: number, data: ModelConfig): Promise<void> {
    await serialService.sendCommand('set_model', { slot, data })
  }

  async function saveConfig(): Promise<void> {
    await serialService.sendCommand('save')
  }

  async function loadConfig(): Promise<void> {
    await serialService.sendCommand('load')
  }

  async function resetConfig(): Promise<void> {
    await serialService.sendCommand('reset')
  }

  function handleResponse(json: Record<string, unknown>): void {
    // 单个模型响应 (get_model) — channels 在顶层且无 models/device
    if (
      Array.isArray(json.channels)
      && !json.models
      && !json.device
      && _pendingModelSlot !== null
      && config.value
    ) {
      config.value.models[_pendingModelSlot] = json as unknown as ModelConfig
      rr.tryResolve(`get_model_${_pendingModelSlot}`)
      return
    }

    if (json.cmd === 'get_info' || json.device) {
      deviceInfo.value = json as unknown as DeviceInfo
    }
    if (json.models) {
      config.value = json as unknown as AppConfig
    }
    if (json.channel_count !== undefined && json.input_sources) {
      deviceInfo.value = json as unknown as DeviceInfo
    }

    // 匹配等待中的请求，resolve 对应 Promise
    const cmd = json.cmd as string | undefined
    if (cmd) rr.tryResolve(cmd)
  }

  return {
    deviceInfo,
    config,
    loading,
    error,
    activeModelIndex,
    modelCount,
    activeModel,
    fetchDeviceInfo,
    fetchConfig,
    fetchAllModels,
    fetchModel,
    setActiveModel,
    setModel,
    saveConfig,
    loadConfig,
    resetConfig,
    handleResponse,
  }
})
