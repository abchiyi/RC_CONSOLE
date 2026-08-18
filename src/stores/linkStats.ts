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
  rfMode: number    // RF 模式
  txPower: number   // 发射功率 dBm
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

/** 尝试匹配动态功率的已知字段名（优先级从高到低） */
const DYN_POWER_NAMES = [
  'Dynamic', 'Dyn Power', 'DYNPWR', 'DynPwr',
  'dynamic', 'dyn power', 'Dyn pwr',
  'TPWR_DYN', 'tpower_dynamic',
]

/** 模糊匹配：忽略大小写与空格，判断字段名是否属于动态功率 */
function looksLikeDynPower(name: string): boolean {
  const n = name.replace(/\s/g, '').toLowerCase()
  return n.includes('dyn') || n.includes('dynamic')
}

export const useLinkStatsStore = defineStore('linkStats', () => {
  const valid = ref(false)
  const fieldCount = ref(0)
  const ulRssi = ref(0)
  const ulLq = ref(0)
  const dlRssi = ref(0)
  const dlLq = ref(0)
  const rfMode = ref(0)
  const txPower = ref(0)

  // ELRS 字段列表
  const fields = ref<ElrsFieldInfo[]>([])
  // 字段列表版本号：rescan 完成后递增，用于强制下游重建字段树（规避 v-list-group 渲染不同步）
  const fieldsVersion = ref(0)
  const dynPowerOn = ref<boolean | null>(null)  // null = 未找到字段
  const dynPowerField = ref<string>('')            // 缓存找到的字段名 (精确)
  const dynPwrLoading = ref(false)

  // ELRS 模块是否在与 UART 通信（字段发现完成）
  const moduleAlive = computed(() => fieldCount.value > 0)

  /** 从字段列表中查找动态功率字段值，并缓存精确字段名 */
  function updateDynPowerFromFields(list: ElrsFieldInfo[]): void {
    // 先精确匹配已知名称
    for (const f of list) {
      if (DYN_POWER_NAMES.some(n => f.name === n)) {
        dynPowerField.value = f.name
        if (f.value !== undefined) {
          dynPowerOn.value = f.value !== 0
        } else if (f.text !== undefined) {
          dynPowerOn.value = f.text === '1' || f.text === 'On' || f.text === 'on'
        }
        return
      }
    }
    // 再模糊匹配
    for (const f of list) {
      if (looksLikeDynPower(f.name)) {
        dynPowerField.value = f.name
        if (f.value !== undefined) {
          dynPowerOn.value = f.value !== 0
        } else if (f.text !== undefined) {
          dynPowerOn.value = f.text === '1' || f.text === 'On' || f.text === 'on'
        }
        return
      }
    }
    dynPowerOn.value = null
    dynPowerField.value = ''
  }

  function update(json: Record<string, unknown>): void {
    fieldCount.value = (json.field_count as number) ?? 0
    valid.value = !!json.valid
    if (!valid.value) return
    ulRssi.value = (json.ul_rssi as number) ?? 0
    ulLq.value = (json.ul_lq as number) ?? 0
    dlRssi.value = (json.dl_rssi as number) ?? 0
    dlLq.value = (json.dl_lq as number) ?? 0
    rfMode.value = (json.rf_mode as number) ?? 0
    txPower.value = (json.tx_power as number) ?? 0
  }

  const rr = new RequestResponseHandler()

  /** 从固件拉取 ELRS 字段列表；缓存为空时固件异步触发发现，连续两次结果一致视为稳定完整缓存 */
  async function fetchFields(timeoutMs = 5000): Promise<void> {
    dynPwrLoading.value = true
    const deadline = Date.now() + timeoutMs
    let lastCount = -1
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
        if (n > 0 && n === lastCount) return  // 连续两次一致 → 发现已稳定，返回完整缓存
        lastCount = n
        if (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } while (Date.now() < deadline)
    } finally {
      dynPwrLoading.value = false
    }
  }

  /** 强制重新发现字段：无条件清空固件缓存并异步重建，轮询拉取新缓存直至非空或超时 */
  async function rescanFields(): Promise<void> {
    dynPwrLoading.value = true
    try {
      const p = rr.wait('elrs_rescan_fields', 3000)
      await serialService.sendCommand('elrs_rescan_fields')
      try {
        await p
      } catch {
        /* timeout */
      }
      // 固件发现是异步的（逐字段队列读取，需数秒），fetchFields 内部轮询直至连续两次结果一致
      await fetchFields(12000)
      fieldsVersion.value++  // 强制下游重建字段树，规避 v-list-group 渲染不同步
    } finally {
      dynPwrLoading.value = false
    }
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  /** 写后联动刷新：固件会后台重读父文件夹/同层级/自身字段（对齐 Lua reloadRelatedFields），稍候重拉缓存以同步 UI */
  function scheduleFieldRefresh(delayMs = 800): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void fetchFields(8000)
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

  /** 切换动态功率 (使用缓存的精确字段名) */
  async function toggleDynPower(enable: boolean): Promise<boolean> {
    const fieldName = dynPowerField.value
    if (!fieldName) {
      // 回退：尝试从 fields 中重新匹配
      for (const f of fields.value) {
        if (DYN_POWER_NAMES.includes(f.name) || looksLikeDynPower(f.name)) {
          dynPowerField.value = f.name
          break
        }
      }
      if (!dynPowerField.value) return false
    }

    const ok = await setParam(dynPowerField.value, enable ? 1 : 0)
    if (ok) {
      dynPowerOn.value = enable
    }
    return ok
  }

  // ---- ELRS 常用指令（直发命令，无状态机）----

  /** 发送单个 ELRS 指令命令，返回是否执行成功（命令下发成功即 ok） */
  async function sendElrsCommand(cmd: string): Promise<boolean> {
    try {
      const p = rr.wait(cmd, 3000)
      await serialService.sendCommand(cmd)
      const resp = (await p) as Record<string, unknown>
      return !!resp.ok
    } catch {
      return false
    }
  }

  function wifiStart(): Promise<boolean> { return sendElrsCommand('elrs_wifi_start') }
  function wifiStop(): Promise<boolean> { return sendElrsCommand('elrs_wifi_stop') }
  function bleStart(): Promise<boolean> { return sendElrsCommand('elrs_ble_start') }
  function bleStop(): Promise<boolean> { return sendElrsCommand('elrs_ble_stop') }
  function bindStart(): Promise<boolean> { return sendElrsCommand('elrs_bind_start') }

  function handleElrsResponse(json: Record<string, unknown>): void {
    const cmd = json.cmd as string | undefined
    if (!cmd) return

    if (cmd === 'elrs_list_fields') {
      fields.value = (json.fields as ElrsFieldInfo[]) ?? []
      fieldCount.value = fields.value.length
      updateDynPowerFromFields(fields.value)
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

    // 快捷指令（wifi/ble/bind）：仅 resolve，无状态回读
    if (cmd === 'elrs_wifi_start' || cmd === 'elrs_wifi_stop' ||
        cmd === 'elrs_ble_start' || cmd === 'elrs_ble_stop' ||
        cmd === 'elrs_bind_start') {
      rr.tryResolve(cmd, json)
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
    ulRssi, ulLq, dlRssi, dlLq, rfMode, txPower,
    fields, fieldsVersion, dynPowerOn, dynPowerField, dynPwrLoading,
    update, fetchFields, rescanFields, setParam, toggleDynPower, handleElrsResponse,
    wifiStart, wifiStop, bleStart, bleStop, bindStart,
    startLinkStream, stopLinkStream,
  }
})
