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

export interface ChannelCondition {
  enabled: boolean
  source_channel: number        // 监视的源通道 (0-15)
  op: number                    // 0:>, 1:<, 2:>=, 3:<=, 4:==, 5:!=
  threshold: number             // CRSF raw 阈值
  switch_source: boolean        // false=固定值, true=切换输入源
  value: number                 // CRSF raw, switch_source=false 时生效
  alt_source: string            // InputSource 字符串, switch_source=true 时生效
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
  condition: ChannelCondition
  lock_enabled: boolean         // 安全锁: 固定 CH4 > 1500μs 时解锁
  lock_value: number            // 锁定时输出值 (μs)
  mix_enabled: boolean          // 混合输入开关
  mix_items: Array<{            // 混合项列表 (最多 4 项)
    src: string                 // InputSource 字符串
    w: number                   // 权重 -100..100
    reverse: boolean            // 反向
  }>
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

  async function fetchActiveModel(): Promise<void> {
    loading.value = true
    error.value = null
    const promise = rr.wait('get_active')
    await serialService.sendCommand('get_active')
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
      active_model: activeSlot ?? config.value?.active_model ?? 0,
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

  async function setActiveModel(slot: number): Promise<boolean> {
    const p = rr.wait('set_active', 2000)
    await serialService.sendCommand('set_active', { slot })
    try { const ok = await p; return ok !== false } catch { error.value = '激活模型超时'; return false }
  }

  async function setRuntimeModel(slot: number): Promise<boolean> {
    const p = rr.wait('set_runtime_model', 2000)
    await serialService.sendCommand('set_runtime_model', { slot })
    try { const ok = await p; return ok !== false } catch { error.value = '切换运行模型超时'; return false }
  }

  async function setModel(slot: number, data: ModelConfig): Promise<boolean> {
    const tag = `set_model_${slot}`
    const p = rr.wait(tag, 3000)
    await serialService.sendCommand('set_model', { slot, data })
    try { const ok = await p; return ok !== false } catch { error.value = '模型写入超时'; return false }
  }

  async function saveConfig(): Promise<boolean> {
    const p = rr.wait('save', 3000)
    await serialService.sendCommand('save')
    try { const ok = await p; return ok !== false } catch { error.value = '保存配置超时'; return false }
  }

  async function loadConfig(): Promise<void> {
    await serialService.sendCommand('load')
  }

  async function resetConfig(): Promise<void> {
    await serialService.sendCommand('reset')
  }

  function handleResponse(json: Record<string, unknown>): void {
    const cmd = json.cmd as string | undefined

    // 通用错误响应 (无 cmd 字段): 匹配当前等待中的请求并记录错误
    if (json.error && !cmd) {
      error.value = json.error as string
      const pending = rr.pendingCmd
      if (pending) rr.tryResolve(pending, false)
      return
    }

    // set_model 响应: 优先使用 slot 匹配；兼容旧固件无 slot 时回退到 pendingCmd
    if (cmd === 'set_model') {
      const ok = json.ok ? true : false
      if (json.slot !== undefined) {
        const tag = `set_model_${json.slot}`
        rr.tryResolve(tag, ok)
      } else {
        const pending = rr.pendingCmd
        if (pending && pending.startsWith('set_model_')) {
          rr.tryResolve(pending, ok)
        }
      }
      if (!ok) error.value = (json.error as string) || '模型写入失败'
      return
    }

    if (cmd === 'set_active' && json.slot !== undefined) {
      if (json.ok && config.value) {
        config.value.active_model = Number(json.slot)
      }
      rr.tryResolve('set_active', json.ok ? true : false)
      if (!json.ok) error.value = (json.error as string) || '激活模型失败'
      return
    }

    if (cmd === 'get_active' && json.active_model !== undefined) {
      const activeModel = Number(json.active_model)
      if (!config.value) {
        config.value = {
          radio_mode: 0,
          active_model: activeModel,
          lpf_alpha: 0,
          models: [],
        }
      } else {
        config.value.active_model = activeModel
      }
      rr.tryResolve('get_active', activeModel)
      return
    }

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
      console.log('[Config] input_sources:', (json as any).input_sources?.map((s: any) => s.id))
    }
    if (json.models) {
      config.value = json as unknown as AppConfig
    }
    if (json.channel_count !== undefined && json.input_sources) {
      deviceInfo.value = json as unknown as DeviceInfo
    }

    // 匹配等待中的请求，resolve 对应 Promise (复用顶部的 cmd 变量)
    if (cmd) rr.tryResolve(cmd, json.ok)
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
    fetchActiveModel,
    fetchAllModels,
    fetchModel,
    setActiveModel,
    setRuntimeModel,
    setModel,
    saveConfig,
    loadConfig,
    resetConfig,
    handleResponse,
  }
})
