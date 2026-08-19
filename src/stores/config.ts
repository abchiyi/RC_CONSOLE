/**
 * 配置/模型管理 Store
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'
import { RequestResponseHandler } from '@/utils/requestResponse'
import { encodeChannelTlv } from '@/utils/commands'

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
  low: number                   // 范围下限 (μs)
  high: number                  // 范围上限 (μs)
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

  // 已同步到固件 RAM 的模型 baseline (差分同步对比基准)
  const syncedModels = ref<Record<number, ModelConfig>>({})

  // ---- 差分同步辅助 ----

  function cloneModel(m: ModelConfig): ModelConfig {
    return JSON.parse(JSON.stringify(m)) as ModelConfig
  }

  function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  /**
   * 对比前端数据与已同步 baseline, 返回差分描述:
   *  - name: null=未变(不发送); 否则为最新 name (即使空串, 用于清空)
   *  - channels: Map<通道索引, 最新通道>, 仅包含变化的通道
   * 无 baseline (槽位从未拉取/从未同步过) 时视为全量变化。
   * 返回 null 表示无任何变化。
   */
  function diffModel(
    data: ModelConfig,
    base: ModelConfig | undefined,
  ): { name: string | null; channels: Map<number, ModelChannel> } | null {
    if (!base) {
      const channels = new Map<number, ModelChannel>()
      for (let i = 0; i < data.channels.length && i < 16; i++) {
        const ch = data.channels[i]
        if (ch) channels.set(i, ch)
      }
      return { name: data.name, channels }
    }
    const nameChanged = String(data.name) !== String(base.name)
    const changed = new Map<number, ModelChannel>()
    for (let i = 0; i < 16; i++) {
      const a = data.channels[i]
      const b = base.channels[i]
      if (!a) continue
      if (!b || !bytesEqual(encodeChannelTlv(a), encodeChannelTlv(b))) changed.set(i, a)
    }
    if (!nameChanged && changed.size === 0) return null
    return { name: nameChanged ? data.name : null, channels: changed }
  }

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
    // get_config 响应含全部模型名; 8s 超时兜底旧固件 12KB 大响应在 BLE 分片下的慢传输
    const promise = rr.wait('get_config', 8000)
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
    // 固件二进制协议无 get_active；active_model 由 get_config 响应提供
    // get_config 响应含全部模型名; 8s 超时兜底旧固件 12KB 大响应在 BLE 分片下的慢传输
    const promise = rr.wait('get_config', 8000)
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

  // 只拉当前激活 model 的数据（避免逐个拉取全部模型在 BLE 低带宽下超时）
  async function fetchActiveModelData(): Promise<void> {
    const count = deviceInfo.value?.model_count ?? 0
    if (count === 0 || !config.value) return

    // 重建占位 models 数组（长度 = model_count，仅当前激活槽位有真实数据）
    // 保留已从 get_config 拿到的模型名, 避免切换槽位前名字被清空
    config.value.models = new Array(count).fill(null).map((_, i) => ({
      name: config.value?.models?.[i]?.name ?? '',
      channels: [],
    }))
    await fetchModel(config.value.active_model)
  }

  async function fetchModel(slot: number): Promise<void> {
    loading.value = true
    const tag = `get_model_${slot}`
    // 5000ms: BLE 下 get_model 响应 ~1.5KB 需多帧通知, 2s 过短导致 baseline 拉取失败 → 差分退化为全量
    const p = rr.wait(tag, 5000)
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
    // 差分同步: 与已同步 baseline 对比, 无变化则跳过发送 (视为成功)
    const diff = diffModel(data, syncedModels.value[slot])
    if (!diff) return true
    const tag = `set_model_${slot}`
    const p = rr.wait(tag, 3000)
    await serialService.sendCommand('set_model', { slot, diff })
    try {
      const ok = await p
      // 成功后更新 baseline, 作为下一次差分的基准
      if (ok) syncedModels.value[slot] = cloneModel(data)
      return ok !== false
    } catch {
      error.value = '模型写入超时'
      return false
    }
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

    // get_model 解析失败响应 (ok:false, 解码异常被 decodeResponse 捕获):
    // 用 pending slot 立即 resolve 对应 promise, 避免静默等 2s 超时
    if (cmd === 'get_model' && json.ok === false && _pendingModelSlot !== null) {
      console.warn(`[Config] model ${_pendingModelSlot} 响应解析失败: ${json.error}`)
      rr.tryResolve(`get_model_${_pendingModelSlot}`, null)
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
      // 记录已同步 baseline, 作为后续差分同步的对比基准
      syncedModels.value[_pendingModelSlot] = cloneModel(json as unknown as ModelConfig)
      rr.tryResolve(`get_model_${_pendingModelSlot}`)
      return
    }

    if (json.cmd === 'get_info' || json.device) {
      deviceInfo.value = json as unknown as DeviceInfo
      console.log('[Config] input_sources:', (json as any).input_sources?.map((s: any) => s.id))
    }
    if (json.models && Array.isArray(json.models)) {
      const incoming = json as unknown as AppConfig
      const prev = config.value
      // 合并响应: 标量直接覆盖; 模型槽位只更新 name, 保留已由 get_model 拉取的完整 channels
      // (固件 get_config 现仅返回模型名, 不整体覆盖以免清空已加载的通道数据)
      config.value = {
        radio_mode: incoming.radio_mode ?? prev?.radio_mode ?? 0,
        active_model: incoming.active_model ?? prev?.active_model ?? 0,
        lpf_alpha: incoming.lpf_alpha ?? prev?.lpf_alpha ?? 0,
        models: incoming.models.map((m, i) => {
          const name = m.name || prev?.models?.[i]?.name || ''
          // 固件返回的权威 name 同步到 baseline, 避免后续差分误报 name 变化
          const synced = syncedModels.value[i]
          if (synced) synced.name = name
          return {
            name,
            channels: prev?.models?.[i]?.channels?.length
              ? prev.models[i]!.channels
              : (m.channels ?? []),
          }
        }),
      }
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
    fetchActiveModelData,
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
