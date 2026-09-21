/**
 * 流式推送会话仲裁器
 *
 * 背景：固件是「单流会话」—— 全局只有一个 StreamSession，且 stream_start() 内部先调用
 * stream_stop() (lib/CommandCenter/command_center.cpp:1473)，所以「启动新流」本身就是一次
 * 原子切换。前端不必（也不应该）为了礼让而先发一条 stream_stop：那只会制造一条延迟到达的
 * 流关闭命令，可能关掉下一个页面刚启动的流 —— BLE 写入带重试退避（20/40/60ms），
 * 命令到达顺序并无保证。
 *
 * 策略：
 *   1. 各页面/Store 只「登记自己想要的流」，不再直接下发命令
 *   2. 请求变更去抖到下一轮再统一下发：路由切换时旧页 release 与新页 request 落在同一批次，
 *      去抖后只剩一个最终结论，因此只产生一条 stream_start（固件侧自动替换旧流）
 *   3. 下发后等待固件响应，用回显的实际生效值校正 applied —— 这是唯一可靠的真相源
 *      （固件回显见 command_center.cpp:1276-1279，前端解码见 utils/commands.ts:447）
 */
import { ref } from 'vue'
import {
  serialService, webSerialService, electronSerialService, bleService,
} from '@/services/SerialService'
import { RequestResponseHandler } from '@/utils/requestResponse'

export interface StreamRequest {
  owner: string
  content_type: number
  interval_ms: number
  flags: number
}

/** 流请求归属方。同一时刻只有一个生效（固件单流会话），冲突时按 OWNER_PRIORITY 取高者 */
export const OWNER = {
  CHANNELS: 'channels',
  CALIBRATION: 'calibration',
  LINK: 'link',
} as const

/** owner 优先级：数值大者优先（校准实时性最高 > 链路 > 通道） */
const OWNER_PRIORITY: Record<string, number> = {
  [OWNER.CALIBRATION]: 2,
  [OWNER.LINK]: 1,
  [OWNER.CHANNELS]: 0,
}

/** 等待 stream_start 响应的超时。超时不视为失败，退化为信任本地请求值（下次 flush 自愈） */
const ECHO_TIMEOUT_MS = 2000

const requests = new Map<string, StreamRequest>()
const rr = new RequestResponseHandler()

/** 已确认在固件侧生效的流（由响应回显校正）。null = 固件当前无流 */
const applied = ref<StreamRequest | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let flushing = false
/** 代次：releaseAll / 后端切换时自增，让在飞行的 flush 回写失效 */
let gen = 0

/** 固件 stream_start 响应回显实际生效值 → 作为真相源 resolve 等待者 */
function onObject(obj: Record<string, unknown>): void {
  if (obj.cmd === 'stream_start') rr.tryResolve('stream_start', obj)
}

// 后端可切换（如切到 BLE），必须对每个后端都注册，否则切换后收不到响应（同 main.ts 做法）
;[webSerialService, electronSerialService, bleService, serialService]
  .forEach(svc => svc.onObject(onObject))

function priorityOf(owner: string): number {
  return OWNER_PRIORITY[owner] ?? 0
}

/** 从所有请求中选出当前应生效的那个（优先级高者胜） */
function pick(): StreamRequest | null {
  let best: StreamRequest | null = null
  for (const r of requests.values()) {
    if (!best || priorityOf(r.owner) > priorityOf(best.owner)) best = r
  }
  return best
}

/** 仅比较「对固件而言是否等价」，owner 不同但参数相同则无需重发 */
function sameReq(a: StreamRequest | null, b: StreamRequest | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.content_type === b.content_type
    && a.interval_ms === b.interval_ms
    && a.flags === b.flags
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, 0)
}

async function flush(): Promise<void> {
  // 串行化：一次只跑一个 flush，期间的新请求留到下一轮
  if (flushing) {
    schedule()
    return
  }
  const want = pick()
  if (sameReq(want, applied.value)) return

  flushing = true
  const myGen = ++gen
  try {
    const connected = serialService.isConnected

    if (!want) {
      // 无人需要流 → 关闭（未连接时无需下发）
      if (connected) await serialService.sendCommand('stream_stop')
      if (myGen === gen) applied.value = null
      return
    }

    if (!connected) {
      // 未连接：命令无处可发，标记未生效，重连后由各页面重新 request
      if (myGen === gen) applied.value = null
      return
    }

    let echoed: Record<string, unknown> | undefined
    try {
      const p = rr.wait('stream_start', ECHO_TIMEOUT_MS)
      await serialService.sendCommand('stream_start', {
        content_type: want.content_type,
        interval_ms: want.interval_ms,
        flags: want.flags,
      })
      echoed = (await p) as Record<string, unknown> | undefined
    } catch {
      // 超时或被新请求取代：退化为信任本地请求值，后续 flush 会用真实响应自愈
      echoed = undefined
    }

    if (myGen === gen) {
      applied.value = {
        ...want,
        content_type: Number(echoed?.content_type ?? want.content_type),
        interval_ms: Number(echoed?.interval_ms ?? want.interval_ms),
        flags: Number(echoed?.flags ?? want.flags),
      }
    }
  } finally {
    flushing = false
    // 仅当 flush 期间请求发生了变化才补跑一轮。
    // 不能只判「期望 ≠ 已生效」：未连接时两者恒不等，会退化成空转的自旋调度。
    const now = pick()
    if (!sameReq(now, want) && !sameReq(now, applied.value)) schedule()
  }
}

/** 登记/更新一个流请求（幂等，同 owner 覆盖） */
export function requestStream(req: StreamRequest): void {
  requests.set(req.owner, { ...req })
  schedule()
}

/** 撤销某个 owner 的流请求 */
export function releaseStream(owner: string): void {
  if (!requests.delete(owner)) return
  schedule()
}

/**
 * 断开/重连场景：清空全部请求并使在飞行的 flush 回写失效。
 * 刻意不发 stream_stop —— 连接已断开，命令无处可去；重连后由各页面重新 request。
 */
export function releaseAllStreams(): void {
  requests.clear()
  gen++
  applied.value = null
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

export { applied as appliedStream }
