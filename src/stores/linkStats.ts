/**
 * ELRS 链路统计 Store
 * 通过 STREAM content_type=3 流式推送上行/下行 RSSI、LQ、发射功率
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { serialService } from '@/services/SerialService'
import { RequestResponseHandler } from '@/utils/requestResponse'
import { OWNER, requestStream, releaseStream } from './stream'

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

/**
 * Packet Rate 允许的上限（Hz），含该值本身；更高的档位一概屏蔽。
 * 333Hz 实测可正常回读，故放行；500Hz / D500 / F500 三个档位切过去后模块会停止上报
 * Packet Rate 字段（切换后约 27s 无响应，重新扫描时字段已不存在），
 * 继续下发必然导致回读永久不同步。
 *
 * 实机选项文本形如（id=1 min=0）：
 *   '50Hz(-115dBm);100Hz Full(-112dBm);150Hz(-112dBm);250Hz(-108dBm);
 *    333Hz Full(-105dBm);500Hz(-105dBm);D250(-104dBm);D500(-104dBm);F500(-104dBm)'
 * 末尾带接收灵敏度说明，取速率数值前必须先剥掉括号段。
 */
const MAX_ALLOWED_RATE_HZ = 333

/** 从档位文本中取出速率数值：'333Hz Full(-105dBm)' → 333，'D250(-104dBm)' → 250 */
function parseRateHz(label: string): number | null {
  const match = /\d+/.exec(label.replace(/\([^)]*\)/g, ''))
  return match ? Number(match[0]) : null
}

/** 某个取值是否落在被封禁的速率档位上（选项过滤与写入拦截共用同一判据） */
export function isBlockedRateValue(
  field: Pick<ElrsFieldInfo, 'name' | 'options' | 'min'>,
  value: number,
): boolean {
  if (!/packet\s*rate/i.test(field.name ?? '')) return false

  const options = field.options
  if (options && options.length > 0) {
    const base = Number.isFinite(field.min as number) ? Number(field.min) : 0
    const label = options[value - base]
    if (typeof label !== 'string') return false
    const hz = parseRateHz(label)
    // 解析不出速率时不屏蔽，避免误伤未知格式的档位
    return hz != null && hz > MAX_ALLOWED_RATE_HZ
  }

  // 固件未下发 options 时 value 只是档位下标，无法映射回速率，按索引判断会误伤，故不屏蔽
  return false
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
   * 单次拉取字段列表并等待其落库。
   * RequestResponseHandler 按命令名分槽，同一命令重复 wait() 会让旧等待失败，
   * 因此所有 elrs_list_fields 请求必须串行化，否则发现轮询与写后轮询会互相取代。
   */
  let listPullChain: Promise<boolean> = Promise.resolve(true)

  function pullFieldsOnce(timeoutMs = 2000): Promise<boolean> {
    listPullChain = listPullChain
      .then(async () => {
        const p = rr.wait('elrs_list_fields', timeoutMs)
        await serialService.sendCommand('elrs_list_fields')
        try {
          await p
          return true
        } catch {
          return false
        }
      })
      .catch(() => false)
    return listPullChain
  }

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
        await pullFieldsOnce(2000)
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

  // ---- 写后待确认（乐观更新）----
  // 固件侧无法在写入帧里回显"已生效值"：写命令的响应只代表以太网帧已发出，真正的新值要等
  // 后台重读队列读回来。回读延迟受链路负载影响（连接态可达数秒），期间 UI 必须有本地真相，
  // 否则点击后按钮长时间毫无反馈。故在此维护一份"期望值"，回读一致即确认，超时未被确认则丢弃。

  /** 待确认写入：field_id → 期望值 + 发起时刻 */
  const pendingWrites = ref<Record<number, { value: number, at: number }>>({})
  /** 最近一次回读未确认（已回滚）的写入，seq 递增以便相同字段重复失败也能触发 UI 提示 */
  const writeRejected = ref<{ fieldId: number, seq: number } | null>(null)
  /** 最近一次被拒绝下发的写入（该档位本设备不可用），与「回读未确认」区分提示 */
  const writeBlocked = ref<{ fieldId: number, seq: number } | null>(null)

  // 兜底 TTL：略长于写后轮询的总时长，避免轮询仍在跑就被清扫误判为失败
  const PENDING_TTL_MS = 14000

  /** UI 用：field_id → 期望值 */
  const pendingValues = computed<Record<number, number>>(() => {
    const out: Record<number, number> = {}
    for (const [key, entry] of Object.entries(pendingWrites.value)) {
      out[Number(key)] = entry.value
    }
    return out
  })

  let pendingSweeper: ReturnType<typeof setTimeout> | null = null

  /** 回读一致即为已生效；超过 TTL 仍未一致则丢弃，让 UI 回落到设备真实值并向用户提示 */
  function reconcilePending(): void {
    const now = Date.now()
    let changed = false
    const next = { ...pendingWrites.value }
    for (const key of Object.keys(next)) {
      const id = Number(key)
      const entry = next[id]
      if (!entry) continue
      const field = fields.value.find(x => x.id === id)
      if (!field && fieldCount.value > 0) {
        // 字段已从设备列表中消失（例如切到 500Hz / D500 / F500 后 Packet Rate 不再上报）：
        // 已没有可比对的对象，继续挂到 TTL 只会让乐观态空转并误弹「回读未确认」。
        // 这里静默丢弃，不算写入失败（写入本身已即时生效）。
        delete next[id]
        changed = true
      } else if (field && field.value === entry.value) {
        delete next[id]
        changed = true
      } else if (now - entry.at > PENDING_TTL_MS) {
        delete next[id]
        changed = true
        writeRejected.value = { fieldId: id, seq: (writeRejected.value?.seq ?? 0) + 1 }
      }
    }
    if (changed) pendingWrites.value = next
  }

  /** 没有新的字段列表到达时也要能清理超时项 */
  function armPendingSweeper(): void {
    if (pendingSweeper) return
    pendingSweeper = setTimeout(() => {
      pendingSweeper = null
      reconcilePending()
      if (Object.keys(pendingWrites.value).length > 0) armPendingSweeper()
    }, 500)
  }

  function markPending(fieldId: number, value: number): void {
    pendingWrites.value = { ...pendingWrites.value, [fieldId]: { value, at: Date.now() } }
    armPendingSweeper()
  }

  /** 放弃某次写入的乐观值：UI 回落到设备真实值，并通知用户该设置未被确认 */
  function rejectPending(fieldId: number): void {
    if (!(fieldId in pendingWrites.value)) return
    const next = { ...pendingWrites.value }
    delete next[fieldId]
    pendingWrites.value = next
    writeRejected.value = { fieldId, seq: (writeRejected.value?.seq ?? 0) + 1 }
  }

  // ---- 写后定向轮询 ----
  // 原先复用 fetchFields（为"发现缓存渐进增长"设计的收敛判据）：列表已达历史完整数时首轮就 break，
  // 等于只做一次采样；而固件回读可能还没轮到该字段 → UI 长时间停在旧值且再也不会补拉。
  // 改为针对单个字段轮询到回读一致为止，并用 token 保证同一字段的新写入取代旧轮询。

  // 首 poll 前给模块留出提交时间
  const SETTLE_FIRST_DELAY_MS = 600
  const SETTLE_POLL_INTERVAL_MS = 500
  const SETTLE_TIMEOUT_MS = 12000
  let settleToken = 0

  // ---- 命令字段 (type 13 = COMMAND) ----
  // COMMAND 字段没有可比对的值：能回读的只有模块持续回报的状态字节(status)与可读状态文本。
  // 套用 settleField 那种「等回读等于下发值」的判据必然不成立（status 不会等于下发的 1/5），
  // 结果就是轮询到 12s 超时、误弹「设备回读未确认」。故单列一条生命周期：
  // 命令只要发出成功即为已受理，随后在执间期间持续拉列表，呈现模块回报的进度文本。

  /** 正在执行的命令字段：field_id → 发起时刻 */
  const runningCommands = ref<Record<number, number>>({})

  const COMMAND_POLL_INTERVAL_MS = 800
  const COMMAND_WATCH_MAX_MS = 130000 // 略长于固件 ELRS_COMMAND_FOLLOW_MAX_MS

  /** 命令执行期间持续刷新字段列表，直到模块把 status 归 0（命令收尾）或超时 */
  async function watchCommand(fieldId: number): Promise<void> {
    const deadline = Date.now() + COMMAND_WATCH_MAX_MS
    try {
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, COMMAND_POLL_INTERVAL_MS))
        await pullFieldsOnce()
        const field = fields.value.find(x => x.id === fieldId)
        if (!field) break
        if ((field.value ?? 0) === 0) break // status 归 0：命令已结束
      }
    } finally {
      const next = { ...runningCommands.value }
      delete next[fieldId]
      runningCommands.value = next
    }
  }

  /** 轮询直到目标字段回读为期望值；被新写入取代时返回 false */
  async function settleField(fieldId: number, value: number): Promise<boolean> {
    const token = ++settleToken
    const deadline = Date.now() + SETTLE_TIMEOUT_MS
    await new Promise(resolve => setTimeout(resolve, SETTLE_FIRST_DELAY_MS))
    while (token === settleToken && Date.now() < deadline) {
      await pullFieldsOnce()
      const field = fields.value.find(x => x.id === fieldId)
      if (field && field.value === value) {
        reconcilePending()
        return true
      }
      if (token !== settleToken) return false
      await new Promise(resolve => setTimeout(resolve, SETTLE_POLL_INTERVAL_MS))
    }
    // 超时仍未追上：回滚乐观值，UI 回落真实值并提示未被确认
    if (token === settleToken) rejectPending(fieldId)
    return false
  }

  /** 设置 ELRS 参数字段（二进制协议仅接受 field_id，字符串名从字段列表解析） */
  async function setParam(field: string | number, value: number): Promise<boolean> {
    let fieldId: number
    let target: ElrsFieldInfo | undefined
    if (typeof field === 'number') {
      fieldId = field
      target = fields.value.find(x => x.id === fieldId)
    } else {
      const f = fields.value.find(x => x.name === field)
      if (!f) return false
      fieldId = f.id
      target = f
    }

    // 封禁档位在写入口再拦一次：覆盖数值步进器手动输入等绕过选项按钮的路径。
    // 不下发就不会切到「模块不再上报该字段」的速率，避免回读永久不同步。
    if (target && isBlockedRateValue(target, value)) {
      writeBlocked.value = { fieldId, seq: (writeBlocked.value?.seq ?? 0) + 1 }
      return false
    }

    const p = rr.wait('elrs_set_param', 3000)
    await serialService.sendCommand('elrs_set_param', { field_id: fieldId, value })
    try {
      const resp = (await p) as Record<string, unknown>
      const ok = !!resp.ok
      if (ok) {
        if (fields.value.find(x => x.id === fieldId)?.type === 13) {
          runningCommands.value = { ...runningCommands.value, [fieldId]: Date.now() }
          void watchCommand(fieldId)
        }
        else {
          // 写命令响应只代表"帧已发出"，此处先落乐观值让 UI 立即反馈，后台再等回读确认
          markPending(fieldId, value)
          void settleField(fieldId, value)
        }
      }
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
      reconcilePending() // 新值回读到立即消掉乐观态
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

  /** 启动链路统计流（固件单流会话，stream_start 自带 stop，交由 stream.ts 仲裁器去抖下发） */
  async function startLinkStream(intervalMs = 100): Promise<void> {
    requestStream({ owner: OWNER.LINK, content_type: 3, interval_ms: intervalMs, flags: 0 })
  }

  /** 停止链路统计流：撤销登记，仲裁器按剩余请求决定是切回通道流还是关闭 */
  async function stopLinkStream(): Promise<void> {
    releaseStream(OWNER.LINK)
  }

  return {
    valid, fieldCount, moduleAlive,
    ulRssi, ulLq, dlRssi, dlLq, txPower,
    fields, fieldsVersion, fieldsLoading,
    pendingValues, writeRejected, writeBlocked, runningCommands,
    update, fetchFields, rescanFields, setParam, handleElrsResponse,
    startLinkStream, stopLinkStream,
  }
})
