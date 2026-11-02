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

export const useLinkStatsStore = defineStore('linkStats', () => {
  const valid = ref(false)
  const fieldCount = ref(0)
  const ulRssi = ref(0)
  const ulLq = ref(0)
  const dlRssi = ref(0)
  const dlLq = ref(0)
  const txPower = ref(0)
  // CRSF 串口波特率（手柄 ↔ ELRS 模块，开机协商后的实际生效值；0 = 未上报/旧固件）
  const uartBaud = ref(0)

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

  /** 串口速率文案: >=1M 用 Mbps, 否则 kbps; 未上报显示 '--' */
  const baudLabel = computed(() => {
    const b = uartBaud.value
    if (!b) return '--'
    return b >= 1_000_000 ? `${(b / 1_000_000).toFixed(2)} Mbps` : `${Math.round(b / 1000)} kbps`
  })

  function update(json: Record<string, unknown>): void {
    fieldCount.value = (json.field_count as number) ?? 0
    valid.value = !!json.valid
    // 波特率在固件侧位于 valid 块之外（是串口属性，与 RF 链路是否建立无关），
    //   故即使未建立链路也要更新，未对频时同样能看到协商结果。
    uartBaud.value = (json.uart_baud as number) ?? 0
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
   * 单次拉取字段缓存（供页面停留期间的跟随轮询使用）。
   * 固件侧的发现与补读是异步的：fetchFields 收敛或超时退出后，模块仍在回报字段
   * （实测顶部「N 项参数」会继续变大），此时只有继续拉取才能跟上，
   * 否则必须切走再切回（重新触发 fetchFields）才能看到新字段。
   */
  function refreshFieldsOnce(timeoutMs = 2000): Promise<boolean> {
    return pullFieldsOnce(timeoutMs)
  }

  /**
   * 从固件拉取 ELRS 字段列表。
   * 固件发现是异步的：缓存从 0 逐步增长，且个别字段在连接态下会整轮超时（模块不响应）。
   * 结束判据（两条任一满足即结束）：
   *   ① 数量达到历史完整枚举值 → 立即结束（无历史基线时不生效，见下）
   *   ② 数量持续 NO_GROW_MS 不再增长 → 认为发现已收敛
   * 注意：不能用"连续两次读数一致"——缓存增长途中一旦卡在超时字段,
   *       连续两次读数必然相同, 会被误判为稳定, 前端只剩半成品列表。
   * 注意：knownCompleteCount 为 0 时（冷启动 / 首次访问）不能算"达标"，
   *       否则刚重扫完的第一轮非空读数就结束，字段树只剩刚发现的前几个。
   */
  async function fetchFields(timeoutMs = 15000): Promise<void> {
    fieldsLoading.value = true
    const NO_GROW_MS = 6000
    /**
     * 从「首个字段出现」起的最短观察时长。
     * 固件是逐字段排队发现的，中途常出现数秒的整轮超时空窗（某个字段模块不响应）。
     * 仅凭 6s 无增长就判收敛，冷启动时会把半成品列表当成最终结果 —— 表现为「字段显示不全」，
     * 且该残缺值一旦记进达标线，之后每次进页一达基线就结束，残缺被锁死，
     * 只能靠切走再切回碰运气补齐（正是本 bug 的表象）。
     */
    const MIN_DISCOVER_MS = 8000
    const deadline = Date.now() + timeoutMs
    let lastCount = -1
    let lastGrowAt = Date.now()
    let firstSeenAt = 0
    let converged = false
    try {
      do {
        await pullFieldsOnce(2000)
        const n = fields.value.length
        if (n > 0 && !firstSeenAt) firstSeenAt = Date.now()
        if (n > lastCount) {
          lastCount = n
          lastGrowAt = Date.now()
        }
        const reachedKnown = knownCompleteCount.value > 0 && n >= knownCompleteCount.value
        const noGrowSettled = n > 0
          && Date.now() - lastGrowAt > NO_GROW_MS
          && firstSeenAt > 0
          && Date.now() - firstSeenAt >= MIN_DISCOVER_MS
        if (n > 0 && (reachedKnown || noGrowSettled)) {
          converged = true
          break
        }
        if (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } while (Date.now() < deadline)

      // 只有判定为「发现已收敛」才把本轮数量记为达标线：
      // 提前结束时的数量是残缺值，记进基线会让后续拉取一达基线就结束，永远停在半成品。
      if (converged && fields.value.length > knownCompleteCount.value) {
        knownCompleteCount.value = fields.value.length
      }
    } finally {
      fieldsLoading.value = false
    }
  }

  /** 强制重新发现字段：无条件清空固件缓存并异步重建，轮询拉取新缓存直至非空或超时
   *  timeoutMs: 整轮发现等待上限（调用方可按节奏收紧，默认给足一轮完整发现） */
  async function rescanFields (timeoutMs = 25000): Promise<void> {
    fieldsLoading.value = true
    try {
      // 强制重新发现前清零达标线：否则首轮读数一达到（可能是残缺的）历史基线就结束，
      // 重扫拿不到完整列表，残缺基线也就永远无法被纠正。
      knownCompleteCount.value = 0
      const p = rr.wait('elrs_rescan_fields', 3000)
      await serialService.sendCommand('elrs_rescan_fields')
      try {
        await p
      } catch {
        /* timeout */
      }
      // 固件发现是异步的（逐字段队列读取，需数秒；连接态下个别字段会整轮超时）
      await fetchFields(timeoutMs)
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
      const list = json.fields as ElrsFieldInfo[] | undefined
      // 响应解析失败（丢帧 / 越界）时 json.fields 缺失：此时用 undefined 覆盖会把已发现的
      // 整张字段树清空，表现为「字段显示不全」。保留旧列表，由后续轮询自愈。
      if (Array.isArray(list)) {
        fields.value = list
        fieldCount.value = list.length
        reconcilePending() // 新值回读到立即消掉乐观态
      }
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

  /**
   * 断开场景：链路统计与 ELRS 字段树整体归零。
   * knownCompleteCount（历史字段数达标线）一并清零 —— 换设备的字段数不同，
   * 留着旧基线会让下一轮的发现提前收敛成半成品。
   * settleToken 自增：让断开瞬间仍在跑的 settleField / watchCommand 尽早退出。
   */
  function reset (): void {
    valid.value = false
    fieldCount.value = 0
    ulRssi.value = 0
    ulLq.value = 0
    dlRssi.value = 0
    dlLq.value = 0
    txPower.value = 0
    uartBaud.value = 0
    fields.value = []
    fieldsLoading.value = false
    knownCompleteCount.value = 0
    pendingWrites.value = {}
    writeRejected.value = null
    runningCommands.value = {}
    settleToken++
    if (pendingSweeper) {
      clearTimeout(pendingSweeper)
      pendingSweeper = null
    }
  }

  return {
    valid, fieldCount, moduleAlive, uartBaud, baudLabel,
    ulRssi, ulLq, dlRssi, dlLq, txPower,
    fields, fieldsVersion, fieldsLoading,
    pendingValues, writeRejected, runningCommands,
    update, fetchFields, refreshFieldsOnce, rescanFields, setParam, handleElrsResponse,
    startLinkStream, stopLinkStream, reset,
  }
})
