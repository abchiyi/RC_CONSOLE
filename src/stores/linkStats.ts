/**
 * ELRS 链路统计 Store
 * 通过 STREAM content_type=3 流式推送上行/下行 RSSI、LQ、发射功率
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'
import { RequestResponseHandler } from '@/utils/requestResponse'

export interface LinkStats {
  valid: boolean
  fieldCount: number
  ulRssi: number    // 上行 RSSI (dBm, 负值)
  ulLq: number      // 上行链路质量 (0~100%)
  dlRssi: number    // 下行 RSSI (dBm, 负值)
  dlLq: number      // 下行链路质量 (0~100%)
  txPower: number   // 发射功率代号 (CRSF uplink_TX_Power, 需查表才能换算为 dBm)
}

export interface ElrsFieldInfo {
  id: number
  parent?: number
  hidden?: boolean
  value_valid?: boolean
  name: string
  type: number
  unit: string
  min?: number
  max?: number
  step?: number
  options?: string[]
  value?: number
  text?: string
}

export const useLinkStatsStore = defineStore('linkStats', () => {
  const valid = ref(false)
  const fieldCount = ref(0)
  const ulRssi = ref(0)
  const ulLq = ref(0)
  const dlRssi = ref(0)
  const dlLq = ref(0)
  const txPower = ref(0)

  // ELRS 字段列表
  const fields = ref<ElrsFieldInfo[]>([])
  // 字段列表版本号：rescan 完成后递增，用于强制下游重建字段树（规避 v-list-group 渲染不同步）
  const fieldsVersion = ref(0)
  // 字段列表拉取中
  const fieldsLoading = ref(false)
  // 历史上完整枚举得到的最大字段数：作为后续拉取的"达标线"
  const knownCompleteCount = ref(0)

  // ELRS 模块是否在与 UART 通信（字段发现完成）
  const moduleAlive = computed(() => fieldCount.value > 0)

  function update(json: Record<string, unknown>): void {
    fieldCount.value = (json.field_count as number) ?? 0
    valid.value = !!json.valid
    if (!valid.value) return
    ulRssi.value = (json.ul_rssi as number) ?? 0
    ulLq.value = (json.ul_lq as number) ?? 0
    dlRssi.value = (json.dl_rssi as number) ?? 0
    dlLq.value = (json.dl_lq as number) ?? 0
    txPower.value = (json.tx_power as number) ?? 0
  }

  const rr = new RequestResponseHandler()

  /**
   * 从固件拉取 ELRS 字段列表。
   * 固件发现是异步的：缓存从 0 逐步增长，且个别字段在连接态下会整轮超时（模块不响应）。
   * 结束判据（两条任一满足即结束）：
   *   ① 数量达到历史完整枚举值 → 立即结束
   *   ② 数量持续 NO_GROW_MS 不再增长 → 认为发现已收敛
   * 注意：不能用"连续两次读数一致"——缓存增长途中一旦卡在超时字段,
   *       连续两次读数必然相同, 会被误判为稳定, 前端只剩半成品列表。
   */
  async function fetchFields(timeoutMs = 15000): Promise<void> {
    fieldsLoading.value = true
    const NO_GROW_MS = 6000
    const deadline = Date.now() + timeoutMs
    let lastCount = -1
    let lastGrowAt = Date.now()
    try {
      do {
        const p = rr.wait('elrs_list_fields', 2000)
        await serialService.sendCommand('elrs_list_fields')
        try {
          await p
        } catch {
          /* 单次超时：继续轮询直到总超时 */
        }
        const n = fields.value.length
        if (n > lastCount) {
          lastCount = n
          lastGrowAt = Date.now()
        }
        if (n > 0 && (n >= knownCompleteCount.value || Date.now() - lastGrowAt > NO_GROW_MS)) {
          break
        }
        if (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } while (Date.now() < deadline)

      // 记录本轮达到的最大数量, 供后续拉取作为达标线
      if (fields.value.length > knownCompleteCount.value) {
        knownCompleteCount.value = fields.value.length
      }
    } finally {
      fieldsLoading.value = false
    }
  }

  /** 强制重新发现字段：无条件清空固件缓存并异步重建，轮询拉取新缓存直至非空或超时 */
  async function rescanFields(): Promise<void> {
    fieldsLoading.value = true
    try {
      const p = rr.wait('elrs_rescan_fields', 3000)
      await serialService.sendCommand('elrs_rescan_fields')
      try {
        await p
      } catch {
        /* timeout */
      }
      // 固件发现是异步的（逐字段队列读取，需数秒；连接态下个别字段会整轮超时）
      await fetchFields(25000)
      fieldsVersion.value++  // 强制下游重建字段树，规避 v-list-group 渲染不同步
    } finally {
      fieldsLoading.value = false
    }
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  /** 写后联动刷新：固件会后台重读父文件夹/同层级/自身字段（对齐 Lua reloadRelatedFields），稍候重拉缓存以同步 UI */
  function scheduleFieldRefresh(delayMs = 2500): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void fetchFields(15000)
    }, delayMs)
  }

  /** 设置 ELRS 参数字段（二进制协议仅接受 field_id，字符串名从字段列表解析） */
  async function setParam(field: string | number, value: number): Promise<boolean> {
    const p = rr.wait('elrs_set_param', 3000)
    if (typeof field === 'number') {
      await serialService.sendCommand('elrs_set_param', { field_id: field, value })
    } else {
      const f = fields.value.find(x => x.name === field)
      if (!f) {
        rr.tryResolve('elrs_set_param', { ok: false })
        return false
      }
      await serialService.sendCommand('elrs_set_param', { field_id: f.id, value })
    }
    try {
      const resp = (await p) as Record<string, unknown>
      const ok = !!resp.ok
      if (ok) scheduleFieldRefresh()
      return ok
    } catch {
      return false
    }
  }

  function handleElrsResponse(json: Record<string, unknown>): void {
    const cmd = json.cmd as string | undefined
    if (!cmd) return

    if (cmd === 'elrs_list_fields') {
      fields.value = (json.fields as ElrsFieldInfo[]) ?? []
      fieldCount.value = fields.value.length
      rr.tryResolve('elrs_list_fields')
      return
    }

    if (cmd === 'elrs_set_param') {
      rr.tryResolve('elrs_set_param', json)
      return
    }

    if (cmd === 'elrs_rescan_fields') {
      rr.tryResolve('elrs_rescan_fields', json)
      return
    }
  }

  // ---- 流式链路统计（STREAM content_type=3）----

  /** 启动链路统计流（固件单流会话：需先停其他流再启动） */
  async function startLinkStream(intervalMs = 100): Promise<void> {
    await serialService.sendCommand('stream_start', {
      content_type: 3,
      interval_ms: intervalMs,
      flags: 0,
    })
  }

  /** 停止链路统计流（恢复通道流前调用） */
  async function stopLinkStream(): Promise<void> {
    await serialService.sendCommand('stream_stop')
  }

  return {
    valid, fieldCount, moduleAlive,
    ulRssi, ulLq, dlRssi, dlLq, txPower,
    fields, fieldsVersion, fieldsLoading,
    update, fetchFields, rescanFields, setParam, handleElrsResponse,
    startLinkStream, stopLinkStream,
  }
})
