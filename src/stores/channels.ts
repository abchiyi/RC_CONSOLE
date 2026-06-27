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
  let pollTimer: ReturnType<typeof setInterval> | null = null

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

  function startPolling(intervalMs = 50): void {
    if (pollTimer) return
    polling.value = true
    pollTimer = setInterval(async () => {
      if (!serialService.isConnected) {
        stopPolling()
        return
      }
      await serialService.sendCommand('get_channels')
    }, intervalMs)
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
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
  }
})
