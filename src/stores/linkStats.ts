/**
 * ELRS 链路统计 Store
 * 通过 get_link_stats 串口命令轮询上行/下行 RSSI、LQ、发射功率
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'

export interface LinkStats {
  valid: boolean
  fieldCount: number
  ulRssi: number    // 上行 RSSI (dBm, 负值)
  ulLq: number      // 上行链路质量 (0~100%)
  dlRssi: number    // 下行 RSSI (dBm, 负值)
  dlLq: number      // 下行链路质量 (0~100%)
  rfMode: number    // RF 模式
  txPower: number   // 发射功率 (dBm)
}

export const useLinkStatsStore = defineStore('linkStats', () => {
  const valid      = ref(false)
  const fieldCount = ref(0)
  const ulRssi     = ref(0)
  const ulLq       = ref(0)
  const dlRssi     = ref(0)
  const dlLq       = ref(0)
  const rfMode     = ref(0)
  const txPower    = ref(0)

  // ELRS 模块是否在与 UART 通信（字段发现完成）
  const moduleAlive = computed(() => fieldCount.value > 0)

  function update(json: Record<string, unknown>): void {
    fieldCount.value = (json.field_count as number) ?? 0
    valid.value = !!json.valid
    if (!valid.value) return
    ulRssi.value  = (json.ul_rssi  as number) ?? 0
    ulLq.value    = (json.ul_lq    as number) ?? 0
    dlRssi.value  = (json.dl_rssi  as number) ?? 0
    dlLq.value    = (json.dl_lq    as number) ?? 0
    rfMode.value  = (json.rf_mode  as number) ?? 0
    txPower.value = (json.tx_power as number) ?? 0
  }

  // ---- 定时轮询 ----

  let timer: ReturnType<typeof setInterval> | null = null

  /** 启动轮询 (ELRS 每 ~100ms 推送一次，10Hz 为自然上限) */
  function startPolling(intervalMs = 100): void {
    stopPolling()
    timer = setInterval(async () => {
      if (!serialService.isConnected) return
      await serialService.sendCommand('get_link_stats')
    }, intervalMs)
  }

  function stopPolling(): void {
    if (timer) { clearInterval(timer); timer = null }
  }

  return { valid, fieldCount, moduleAlive, ulRssi, ulLq, dlRssi, dlLq, rfMode, txPower, update, startPolling, stopPolling }
})
