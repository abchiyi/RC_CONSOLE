/**
 * 16通道实时数据 Store
 * 固件返回 CRSF 原始值 (186-1796)，Store 内部保持原始值
 * 对外暴露 valueUs (μs) 供 UI 显示
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'
import { rawToUs, RAW_CENTER } from '@/utils/crsf'

export interface ChannelSnapshot {
  channels: number[]
  sources: string[]
}

export const useChannelStore = defineStore('channels', () => {
  const channels = ref<number[]>(Array(16).fill(RAW_CENTER))
  const sources = ref<string[]>(Array(16).fill('NONE'))
  const polling = ref(false)
  const lastUpdate = ref(0)
  // 通道数据已并入 STREAM content_type=0：固件按 interval_ms 定时推送，无需轮询定时器
  let started = false

  function update(data: ChannelSnapshot): void {
    if (data.channels) channels.value = [...data.channels]
    if (data.sources) sources.value = [...data.sources]
    lastUpdate.value = Date.now()
  }

  function channelPercent(index: number): number {
    const raw = channels.value[index] ?? RAW_CENTER
    const us = rawToUs(raw)
    return ((us - 1000) / 1000) * 100  // 1000→0%, 1500→50%, 2000→100%
  }

  function channelLabel(index: number): string {
    const src = sources.value[index] ?? 'NONE'
    return src !== 'NONE' ? src : `CH${index}`
  }

  const activeChannels = computed(() =>
    channels.value.map((v, i) => ({
      index: i,
      value: v,              // CRSF raw，内部使用
      valueUs: rawToUs(v),   // μs 脉冲宽度，UI 显示
      source: sources.value[i] ?? 'NONE',
      percent: channelPercent(i),
      label: channelLabel(i),
      used: sources.value[i] !== 'NONE',
    })),
  )

  // 默认 50ms (20fps): 更流畅；MTU=23 平台限制下用小帧减少拆包。
  // flags.bit0=1 附加每通道 source 名称；bit1=1 开启 11-bit 压缩（帧 61B→51B，拆包 4→3）。
  async function startPolling(intervalMs = 50): Promise<void> {
    if (started) return
    if (!serialService.isConnected) return
    started = true
    polling.value = true
    await serialService.sendCommand('stream_start', { content_type: 0, interval_ms: intervalMs, flags: 0x03 })
  }

  async function stopPolling(): Promise<void> {
    if (!started) return
    started = false
    polling.value = false
    if (serialService.isConnected) {
      await serialService.sendCommand('stream_stop')
    }
  }

  /** 断开场景：纯重置标志，不发命令，避免重连后 startPolling 静默 return */
  function resetPolling(): void {
    started = false
    polling.value = false
  }

  return {
    channels,
    sources,
    polling,
    lastUpdate,
    activeChannels,
    update,
    channelPercent,
    channelLabel,
    startPolling,
    stopPolling,
    resetPolling,
  }
})
