/**
 * 遥测 Store — 流式接收飞控 CRSF 遥测原始帧并在本地解析
 *
 * 数据链路（与固件 crsf_telem.h 的透传设计对应）：
 *   飞控 --CRSF 遥测帧--> 手柄固件（原样入队，不翻译）
 *        --STREAM_START(content_type=4)--> 流式推送 EVENT
 *        --decodeCrsfStream()--> 本 Store 按类型解码
 *
 * 与旧实现（旁路监听 MAVLink）的区别：
 *   · 走的是**正常流式通道**，不再需要把某个口切成"纯遥测口"、也不再有
 *     "命令通道被固件静默丢弃"的自锁问题；
 *   · 固件不翻译，因此不存在消息定义版本 / wire 顺序 / 裁零规则这类翻译层错误，
 *     新增遥测类型只需在本仓 `utils/crsf.ts` 补一个分支。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { OWNER, releaseStream, requestStream } from '@/stores/stream'
import {
  CRSF_TYPE,
  crsfTypeName,
  decodeAirspeed,
  decodeAttitude,
  decodeBaroAlt,
  decodeBattery,
  decodeCrsfStream,
  decodeFlightMode,
  decodeGps,
  decodeLinkStats,
  decodeVario,
  CRSF_LINK_STATS_PAYLOAD_LEN,
  type CrsfAttitude,
  type CrsfBattery,
  type CrsfFrame,
  type CrsfGps,
  type CrsfLinkStats,
  toHex,
} from '@/utils/crsfTelemetry'

/** 每秒结算窗口；原始帧环形缓冲上限 */
const TICK_MS = 1000
const MAX_RAW_FRAMES = 100
/** 流式推送间隔：10Hz —— 遥测帧本身多为 1~10Hz，再快只是空包 */
const STREAM_INTERVAL_MS = 100

export interface FrameStat {
  /** CRSF 帧类型 */
  type: number
  name: string
  /** 累计帧数 */
  count: number
  /** 最近 1s 窗口内的帧数 ≈ Hz */
  hz: number
  lastMs: number
  /** 该类型累计 CRC 校验失败数 */
  crcErrors: number
}

export interface RawFrameEntry {
  t: number
  type: number
  name: string
  size: number
  hex: string
  crcOk: boolean
}

export const useTelemetryStore = defineStore('telemetry', () => {
  // ---- 流控制 ----
  const streaming = ref(false)
  const paused = ref(false)
  /** 原始帧 hex 采集开关（默认关：高频帧下拷贝 hex 有成本） */
  const captureRaw = ref(false)

  // ---- 统计 ----
  const bytesPerSec = ref(0)
  const framesPerSec = ref(0)
  const totalFrames = ref(0)
  const totalBytes = ref(0)
  /** CRSF 帧 CRC 校验失败数（链路误码 / 帧同步异常的直接指标） */
  const crcErrors = ref(0)
  /** 帧长不自洽 / 越界的坏包数（协议层搬运异常） */
  const badFrames = ref(0)
  const lastFrameMs = ref(0)

  // ---- 解码出的最新值（按 CRSF 帧类型） ----
  const gps = ref<CrsfGps | null>(null)
  const battery = ref<CrsfBattery | null>(null)
  const attitude = ref<CrsfAttitude | null>(null)
  const link = ref<CrsfLinkStats | null>(null)
  /** 升降速度 m/s（正 = 爬升） */
  const vario = ref<number | null>(null)
  /** 气压高度 m（相对起飞点，量纲系数见 crsf.ts 的 SCALE） */
  const baroAlt = ref<number | null>(null)
  /** 空速 km/h */
  const airspeed = ref<number | null>(null)
  const flightMode = ref<string>('')

  const rawFrames = ref<RawFrameEntry[]>([])

  /** 距最后一帧的毫秒数（UI 判断"数据陈旧/断流"） */
  const frameAgeMs = computed(() =>
    lastFrameMs.value === 0 ? -1 : Date.now() - lastFrameMs.value,
  )
  /** 是否已收到过遥测帧 */
  const streamAlive = computed(() => lastFrameMs.value > 0)

  // ---- 帧类型统计（内部可变对象 → 结算时写回 ref 触发更新）----
  interface FrameStatInternal {
    type: number
    name: string
    count: number
    hz: number
    windowCount: number
    lastMs: number
    crcErrors: number
  }
  const statsInternal = new Map<number, FrameStatInternal>()
  const statsVersion = ref(0)
  const frameStats = computed<FrameStat[]>(() => {
    void statsVersion.value // 依赖：结算后刷新
    const list = [...statsInternal.values()]
      .map(s => ({
        type: s.type,
        name: s.name,
        count: s.count,
        hz: s.hz,
        lastMs: s.lastMs,
        crcErrors: s.crcErrors,
      }))
    // 按累计帧数降序：不用 Array#sort（本仓 lint 禁原地 sort，且 lib 未含 toSorted）
    const out: FrameStat[] = []
    for (const item of list) {
      let idx = out.length
      while (idx > 0 && (out[idx - 1]?.count ?? 0) < item.count) {
        idx--
      }
      out.splice(idx, 0, item)
    }
    return out
  })

  let tickTimer: ReturnType<typeof setInterval> | null = null
  let windowBytes = 0
  let windowFrames = 0

  /** 按帧类型更新展示用最新值（未收录的类型只计数，不解码） */
  function applyFrame (f: CrsfFrame): void {
    try {
      switch (f.type) {
        case CRSF_TYPE.GPS: {
          gps.value = decodeGps(f.payload)
          break
        }
        case CRSF_TYPE.BATTERY: {
          battery.value = decodeBattery(f.payload)
          break
        }
        case CRSF_TYPE.ATTITUDE: {
          attitude.value = decodeAttitude(f.payload)
          break
        }
        case CRSF_TYPE.LINK_STATS: {
          // 负载长度必须够 10 字节：短帧按 int8 边界读只会得到一批 0，不如直接计坏帧
          if (f.payload.length < CRSF_LINK_STATS_PAYLOAD_LEN) {
            badFrames.value++
            break
          }
          link.value = decodeLinkStats(f.payload)
          break
        }
        case CRSF_TYPE.VARIO: {
          vario.value = decodeVario(f.payload)
          break
        }
        case CRSF_TYPE.BARO_ALT: {
          baroAlt.value = decodeBaroAlt(f.payload)
          break
        }
        case CRSF_TYPE.AIRSPEED: {
          airspeed.value = decodeAirspeed(f.payload)
          break
        }
        case CRSF_TYPE.FLIGHT_MODE: {
          flightMode.value = decodeFlightMode(f.payload)
          break
        }
        default: { break
        }
      }
    } catch {
      // 单条解码失败不影响统计
    }
  }

  /**
   * 流式事件入口：由 main.ts 在收到 content_type=4 的 EVENT 时调用。
   * @param payload EVT_STREAM_DATA 的负载（u8 count + count × (u8 size + frame)）
   */
  function handleStreamPayload (payload: Uint8Array): void {
    if (!streaming.value || paused.value) {
      return
    }
    const { frames, badFrames: bad } = decodeCrsfStream(payload)
    if (bad > 0) {
      badFrames.value += bad
    }
    for (const f of frames) {
      windowFrames++
      windowBytes += f.size
      totalFrames.value++
      totalBytes.value += f.size
      lastFrameMs.value = Date.now()

      const stat = statsInternal.get(f.type)
      if (stat) {
        stat.count++
        stat.windowCount++
        stat.lastMs = Date.now()
        if (!f.crcOk) stat.crcErrors++
      } else {
        statsInternal.set(f.type, {
          type: f.type,
          name: crsfTypeName(f.type),
          count: 1,
          hz: 0,
          windowCount: 1,
          lastMs: Date.now(),
          crcErrors: f.crcOk ? 0 : 1,
        })
      }

      if (!f.crcOk) {
        crcErrors.value++
      }

      applyFrame(f)

      if (captureRaw.value) {
        rawFrames.value.unshift({
          t: Date.now(),
          type: f.type,
          name: crsfTypeName(f.type),
          size: f.size,
          hex: toHex(f.raw),
          crcOk: f.crcOk,
        })
        if (rawFrames.value.length > MAX_RAW_FRAMES) {
          rawFrames.value.length = MAX_RAW_FRAMES
        }
      }
    }
  }

  /** 1s 结算：速率 + 各帧类型 Hz */
  function tick (): void {
    bytesPerSec.value = windowBytes
    framesPerSec.value = windowFrames
    windowBytes = 0
    windowFrames = 0
    for (const s of statsInternal.values()) {
      s.hz = s.windowCount
      s.windowCount = 0
    }
    statsVersion.value++
  }

  /** 开始：登记流请求（固件单流会话，与 ELRS 页的链路流互斥，由 stream.ts 仲裁） */
  function start (): void {
    if (streaming.value) {
      return
    }
    streaming.value = true
    requestStream({
      owner: OWNER.TELEMETRY,
      content_type: 4, // STREAM_CT_CRSF_TELEM
      interval_ms: STREAM_INTERVAL_MS,
      flags: 0,
    })
    if (tickTimer === null) {
      tickTimer = setInterval(tick, TICK_MS)
    }
  }

  /** 停止：撤销流请求并结算一次（离开页面时调用） */
  function stop (): void {
    streaming.value = false
    releaseStream(OWNER.TELEMETRY)
    if (tickTimer !== null) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    windowBytes = 0
    windowFrames = 0
  }

  /** 清空统计与列表（保留流） */
  function clear (): void {
    statsInternal.clear()
    statsVersion.value++
    totalFrames.value = 0
    totalBytes.value = 0
    crcErrors.value = 0
    badFrames.value = 0
    bytesPerSec.value = 0
    framesPerSec.value = 0
    lastFrameMs.value = 0
    windowBytes = 0
    windowFrames = 0
    gps.value = null
    battery.value = null
    attitude.value = null
    link.value = null
    vario.value = null
    baroAlt.value = null
    airspeed.value = null
    flightMode.value = ''
    rawFrames.value = []
  }

  function togglePause (): void {
    paused.value = !paused.value
  }

  return {
    streaming, paused, captureRaw,
    bytesPerSec, framesPerSec, totalFrames, totalBytes, crcErrors, badFrames,
    lastFrameMs, frameAgeMs, streamAlive,
    gps, battery, attitude, link, vario, baroAlt, airspeed, flightMode,
    rawFrames, frameStats,
    handleStreamPayload,
    start, stop, clear, togglePause,
  }
})
