/**
 * ELRS 链路统计 Store
 * 通过 get_link_stats 串口命令轮询上行/下行 RSSI、LQ、发射功率
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

  /** 从固件拉取 ELRS 字段列表 */
  async function fetchFields(): Promise<void> {
    dynPwrLoading.value = true
    const p = rr.wait('elrs_list_fields', 3000)
    await serialService.sendCommand('elrs_list_fields')
    try {
      await p
    } catch {
      /* timeout */
    }
    dynPwrLoading.value = false
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
      return !!resp.ok
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

  return {
    valid, fieldCount, moduleAlive,
    ulRssi, ulLq, dlRssi, dlLq, rfMode, txPower,
    fields, dynPowerOn, dynPowerField, dynPwrLoading,
    update, fetchFields, setParam, toggleDynPower, handleElrsResponse,
    startPolling, stopPolling,
  }
})
