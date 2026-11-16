/**
 * Xbox 手柄输出映射 / 灵敏度 Store
 *
 * 与设备通信走独立命令对 xbox_get_cfg(0x0901) / xbox_set_cfg(0x0902)，
 * 响应为 v2 64B blob（6 模拟轴 + 15 按钮；v1 19B 可读入并迁移）。
 *
 * 保存策略：SET 命令自带落 NVS + 立即生效，故不借 CMD_SAVE
 *   （后者会连带落通道/校准，语义不同）。页面「保存」= 发一次 SET。
 *
 * 旧固件没有这两条命令 → 回 S_UNKNOWN_CMD(1)，supported=false，页面控件置灰。
 *
 * 实时预览走 STREAM_START(content_type=6)，与其他页面共用 stream.ts 单流仲裁。
 * 固件采样任务两种开机模式常驻：CDC 模式只发布快照不发 USB 报告，Xbox 模式
 * 250Hz 真实输出。旧固件 stream_start 回 S_BAD_PARAM 时不做重试轰炸。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { serialService } from '@/services/SerialService'
import { useSerialStore } from '@/stores/serial'
import { OWNER, releaseStream, requestStream } from '@/stores/stream'
import {
  defaultXboxConfig,
  encodeXboxBlob,
  isXboxDigitalSource,
  isXboxImuSource,
  XBOX_AXIS_KEYS,
  XBOX_BUTTON_KEYS,
  XBOX_REPORT_SIZE,
  XBOX_SOURCE,
  type XboxAxisKey,
  type XboxButtonKey,
  type XboxConfig,
  type XboxLiveData,
} from '@/utils/commands'
import { RequestResponseHandler } from '@/utils/requestResponse'

/** 实时流推送间隔：20Hz（配置页看映射变化足够流畅，BLE 也吃得消） */
const STREAM_INTERVAL_MS = 50
/** 超过此毫秒数无新帧视为数据陈旧 */
const STALE_MS = 3000

const rr = new RequestResponseHandler()

function clone (c: XboxConfig): XboxConfig {
  const out = defaultXboxConfig()
  out.version = c.version
  for (const k of XBOX_AXIS_KEYS) {
    out.axes[k] = { ...c.axes[k] }
  }
  for (const k of XBOX_BUTTON_KEYS) {
    out.buttons[k] = { ...c.buttons[k] }
  }
  return out
}

export const useXboxStore = defineStore('xbox', () => {
  const serial = useSerialStore()

  /** 设备侧当前生效值（最近一次 GET/SET 回显） */
  const deviceCfg = ref<XboxConfig>(defaultXboxConfig())
  /** 页面编辑副本 */
  const editCfg = ref<XboxConfig>(defaultXboxConfig())
  /** 旧固件不支持该命令组 */
  const supported = ref<boolean | null>(null)
  const busy = ref(false)
  const error = ref('')
  const dirty = ref(false)

  /** ── 实时预览 ── */
  const live = ref<XboxLiveData | null>(null)
  const lastFrameMs = ref(0)
  const streaming = ref(false)

  /** 1s 心跳，让「数据陈旧」判定能自动刷新（computed 依赖它触发重算） */
  const nowMs = ref(Date.now())
  let ageTimer: ReturnType<typeof setInterval> | null = null

  const streamAlive = computed(() => {
    void nowMs.value
    return lastFrameMs.value > 0 && Date.now() - lastFrameMs.value < STALE_MS
  })
  const liveActive = computed(() => streamAlive.value && (live.value?.active ?? false))

  function syncEdit (): void {
    editCfg.value = clone(deviceCfg.value)
    dirty.value = false
  }

  function markDirty (): void {
    dirty.value = true
  }

  /** 把非 IMU 源的量程清零、IMU 源补默认量程（切换源时保持 blob 合法） */
  function onSourceChanged (key: XboxAxisKey): void {
    const a = editCfg.value.axes[key]
    a.half_range_deg = isXboxImuSource(a.source)
      ? (a.half_range_deg >= 5 && a.half_range_deg <= 90 ? a.half_range_deg : 25)
      : 0
    dirty.value = true
  }

  /** 按钮换源：数字源清掉半周/阈值；模拟源补默认阈值 50% */
  function onButtonSourceChanged (key: XboxButtonKey): void {
    const b = editCfg.value.buttons[key]
    const digital = b.source === XBOX_SOURCE.NONE || isXboxDigitalSource(b.source)
    b.half = 0
    b.threshold = digital ? 0 : (b.threshold > 0 && b.threshold <= 100 ? b.threshold : 50)
    dirty.value = true
  }

  /** 从设备读取当前配置 */
  async function fetch (): Promise<boolean> {
    if (!serial.connected) {
      return false
    }
    busy.value = true
    error.value = ''
    try {
      const p = rr.wait('xbox_get_cfg', 4000)
      await serialService.sendCommand('xbox_get_cfg')
      await p
      syncEdit()
      return true
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
      return false
    } finally {
      busy.value = false
    }
  }

  /** 把编辑副本写入设备（自带落 NVS + 立即生效） */
  async function save (): Promise<boolean> {
    if (!serial.connected) {
      return false
    }
    busy.value = true
    error.value = ''
    try {
      const blob = encodeXboxBlob(editCfg.value)
      const p = rr.wait('xbox_set_cfg', 4000)
      await serialService.sendCommand('xbox_set_cfg', { data: blob })
      await p
      syncEdit() // save() 内已按回显更新 deviceCfg
      return true
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
      return false
    } finally {
      busy.value = false
    }
  }

  /** 恢复出厂默认（只改编辑副本，需再点保存才下发） */
  function restoreDefaults (): void {
    editCfg.value = defaultXboxConfig()
    dirty.value = true
  }

  /** 开始实时流：进页面调用（页面 + serial.connected watch 双保险） */
  function start (): void {
    if (streaming.value) {
      return
    }
    streaming.value = true
    requestStream({
      owner: OWNER.XBOX,
      content_type: 6, // STREAM_XBOX_OUTPUT
      interval_ms: STREAM_INTERVAL_MS,
      flags: 0,
    })
    if (ageTimer === null) {
      ageTimer = setInterval(() => {
        nowMs.value = Date.now()
      }, 1000)
    }
  }

  /** 停止实时流：离页/断线调用，只撤销登记不发礼让式 stop（见 stream.ts 文件头） */
  function stop (): void {
    streaming.value = false
    releaseStream(OWNER.XBOX)
    if (ageTimer !== null) {
      clearInterval(ageTimer)
      ageTimer = null
    }
  }

  /** main.ts routeStreamEvent 派发入口（content_type=6） */
  function handleStreamData (obj: Record<string, unknown>): void {
    if (!streaming.value) {
      return
    }
    const d = obj as unknown as Partial<XboxLiveData>
    if (!d.report || d.report.length !== XBOX_REPORT_SIZE) {
      return // 坏帧丢弃，不写全 0 假数据
    }
    live.value = d as XboxLiveData
    lastFrameMs.value = Date.now()
  }

  /** main.ts routeObject 派发入口 */
  function handleResponse (obj: Record<string, unknown>): void {
    const cmd = obj.cmd as string
    if (cmd !== 'xbox_get_cfg' && cmd !== 'xbox_set_cfg') {
      return
    }

    if (obj.ok === false) {
      // S_UNKNOWN_CMD(1) = 旧固件不支持；其余错误留给页面提示
      if (obj.status === 1) {
        supported.value = false
      }
      const msg = typeof obj.error === 'string' ? obj.error : '设备返回失败'
      error.value = msg
      rr.tryResolve(cmd, false)
      return
    }

    supported.value = true
    const cfg = obj.xbox as XboxConfig | undefined
    if (cfg) {
      deviceCfg.value = clone(cfg)
    }
    rr.tryResolve(cmd, true)
  }

  function reset (): void {
    rr.cancel('xbox_get_cfg')
    rr.cancel('xbox_set_cfg')
    deviceCfg.value = defaultXboxConfig()
    editCfg.value = defaultXboxConfig()
    supported.value = null
    busy.value = false
    error.value = ''
    dirty.value = false
    live.value = null
    lastFrameMs.value = 0
    streaming.value = false
    if (ageTimer !== null) {
      clearInterval(ageTimer)
      ageTimer = null
    }
  }

  return {
    deviceCfg, editCfg, supported, busy, error, dirty,
    live, lastFrameMs, streamAlive, liveActive, streaming,
    fetch, save, restoreDefaults, syncEdit, markDirty,
    start, stop, handleStreamData,
    onSourceChanged, onButtonSourceChanged, handleResponse, reset,
  }
})
