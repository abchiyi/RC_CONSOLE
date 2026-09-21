/**
 * 16通道实时数据 Store
 * 固件返回 CRSF 原始值 (186-1796)，Store 内部保持原始值
 * 对外暴露 valueUs (μs) 供 UI 显示
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'
import { rawToUs, RAW_CENTER } from '@/utils/crsf'
import {
  OWNER, appliedStream, requestStream, releaseStream, releaseAllStreams,
} from './stream'

export interface ChannelSnapshot {
  channels: number[]
  sources: string[]
}

export const useChannelStore = defineStore('channels', () => {
  const channels = ref<number[]>(Array(16).fill(RAW_CENTER))
  const sources = ref<string[]>(Array(16).fill('NONE'))
  // 由仲裁器的「已生效流」派生，而非本地标志 —— 避免与固件真实状态脱节
  const polling = computed(() => appliedStream.value?.owner === OWNER.CHANNELS)
  const lastUpdate = ref(0)
  // 通道数据已并入 STREAM content_type=0：固件按 interval_ms 定时推送，无需轮询定时器

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
  //
  // 实际下发由 stream.ts 仲裁器去抖合并：固件是单流会话且 stream_start 内部自带 stop，
  // 因此这里只登记请求，不再发礼让式 stream_stop（否则该命令可能迟到并关掉下一个页面的流）。
  async function startPolling(intervalMs = 50): Promise<void> {
    if (!serialService.isConnected) return
    requestStream({ owner: OWNER.CHANNELS, content_type: 0, interval_ms: intervalMs, flags: 0x03 })
  }

  async function stopPolling(): Promise<void> {
    releaseStream(OWNER.CHANNELS)
  }

  /** 断开场景：清空所有流请求，不发命令，避免重连后 startPolling 静默 return */
  function resetPolling(): void {
    releaseAllStreams()
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
