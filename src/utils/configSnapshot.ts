import type { ModelConfig } from '@/stores/config'
import { decodeModelTlv, encodeModelTlv } from './commands'
/**
 * configSnapshot.ts — 配置快照（二进制）↔ JSON 文件
 *
 * 固件只认**二进制快照**（协议 §5.15）：JSON 的编解码全部放在上位机。
 * 这样设备端不必为 8×16 通道构建 cJSON 树（那会耗尽堆并直接 abort）。
 *
 * 快照布局（小端）：
 *   "RCS1" | u16 version | u8 model_slots
 *   section: u8 type + u32 len + payload
 *
 *   type 0x01        全局标量字段：u8 intCount + i32×N + u8 boolCount + u8×M
 *   type 0x10+slot   模型（就是 GET_MODEL 的 TLV 字节）
 *   type 0x20        analog_cal   : 3 × { i32 min,max,center,dz; u8 invert; i8 half_range }
 *   type 0x21        analog_curve : 6 × { i8 x1,y1,x2,y2 }
 *   type 0x22        imu_cal      : 4 × { f32 x,y,z }
 *   type 0x23        attitude_zero: f32 w,x,y,z + u8 enabled
 */
import { Reader, Writer } from './protocol'

const MAGIC = [0x52, 0x43, 0x53, 0x31] // 'R','C','S','1'
export const SNAPSHOT_VERSION = 1
export const MODEL_SLOTS = 8

const SEC = {
  CONFIG: 0x01,
  MODEL_BASE: 0x10,
  ANALOG_CAL: 0x20,
  ANALOG_CURVE: 0x21,
  IMU_CAL: 0x22,
  ATT_ZERO: 0x23,
} as const

/** 与固件 config.h 的 CONFIG_INT_FIELDS 顺序一致（调序必须同步两端） */
export const CONFIG_INT_FIELDS = [
  'radio_mode', 'active_model', 'idle_warn_s', 'idle_shut_s', 'lpf_alpha',
] as const
/** 与固件 config.h 的 CONFIG_BOOL_FIELDS 顺序一致（新字段只能追加到末尾） */
export const CONFIG_BOOL_FIELDS = ['telem2_usb_en', 'telem2_bt_en', 'lock_zero_imu'] as const

const ANALOG_KEYS = ['trigger', 'joy_x', 'joy_y'] as const
const CURVE_KEYS = ['trigger', 'joy_x', 'joy_y', 'imu_roll', 'imu_pitch', 'imu_yaw'] as const
const IMU_KEYS = ['gyro_bias', 'accel_bias', 'mag_offset', 'mag_scale'] as const

export interface AnalogCal {
  raw_min: number
  raw_max: number
  raw_center: number
  deadzone: number
  invert: boolean
  half_range: number
}

export interface CurveData {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ConfigBackupJson {
  format: 'gamepad2rc-config'
  version: number
  config: Record<string, number | boolean>
  models: ModelConfig[]
  calibration: {
    analog: Record<string, AnalogCal>
    curves: Record<string, CurveData>
    imu: Record<string, Vec3>
    attitude_zero: { w: number, x: number, y: number, z: number, enabled: boolean }
  }
}

function appendSection (w: Writer, type: number, payload: Uint8Array): void {
  w.u8(type)
  w.u32(payload.length)
  w.bytes(payload)
}

function emptyBackup (): ConfigBackupJson {
  return {
    format: 'gamepad2rc-config',
    version: SNAPSHOT_VERSION,
    config: {},
    models: [],
    calibration: {
      analog: {},
      curves: {},
      imu: {},
      attitude_zero: { w: 1, x: 0, y: 0, z: 0, enabled: false },
    },
  }
}

/** 二进制快照 → JSON 对象 */
export function snapshotToJson (bytes: Uint8Array): ConfigBackupJson {
  if (bytes.length < 7) {
    throw new Error('快照长度不足')
  }
  for (const [i, element] of MAGIC.entries()) {
    if (bytes[i] !== element) {
      throw new Error('快照 magic 不符')
    }
  }

  const head = new Reader(bytes.subarray(4))
  const version = head.u16()
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`不支持的快照版本: ${version}`)
  }
  const slots = head.u8()
  if (slots !== MODEL_SLOTS) {
    throw new Error(`模型槽位数不符: 文件 ${slots}，期望 ${MODEL_SLOTS}`)
  }

  const out = emptyBackup()
  out.version = version

  let pos = 7
  while (pos + 5 <= bytes.length) {
    const type = bytes[pos] ?? 0
    const len = (bytes[pos + 1] ?? 0)
      | ((bytes[pos + 2] ?? 0) << 8)
      | ((bytes[pos + 3] ?? 0) << 16)
      | ((bytes[pos + 4] ?? 0) << 24)
    pos += 5
    if (pos + len > bytes.length) {
      throw new Error(`section 0x${type.toString(16)} 长度越界`)
    }
    const payload = bytes.subarray(pos, pos + len)
    pos += len

    if (type === SEC.CONFIG) {
      const r = new Reader(payload)
      const intCount = r.u8()
      for (let i = 0; i < intCount && i < CONFIG_INT_FIELDS.length; i++) {
        out.config[CONFIG_INT_FIELDS[i] ?? ''] = r.i32()
      }
      const boolCount = r.u8()
      for (let i = 0; i < boolCount && i < CONFIG_BOOL_FIELDS.length; i++) {
        out.config[CONFIG_BOOL_FIELDS[i] ?? ''] = !!r.u8()
      }
    } else if (type >= SEC.MODEL_BASE && type < SEC.MODEL_BASE + MODEL_SLOTS) {
      out.models[type - SEC.MODEL_BASE] = decodeModelTlv(payload)
    } else {
      switch (type) {
        case SEC.ANALOG_CAL: {
          const r = new Reader(payload)
          for (const key of ANALOG_KEYS) {
            const rawMin = r.i32()
            const rawMax = r.i32()
            const rawCenter = r.i32()
            const deadzone = r.i32()
            const invert = !!r.u8()
            out.calibration.analog[key] = {
              raw_min: rawMin,
              raw_max: rawMax,
              raw_center: rawCenter,
              deadzone,
              invert,
              half_range: r.i8(),
            }
          }

          break
        }
        case SEC.ANALOG_CURVE: {
          const r = new Reader(payload)
          for (const key of CURVE_KEYS) {
            const x1 = r.i8()
            const y1 = r.i8()
            out.calibration.curves[key] = { x1, y1, x2: r.i8(), y2: r.i8() }
          }

          break
        }
        case SEC.IMU_CAL: {
          const r = new Reader(payload)
          for (const key of IMU_KEYS) {
            const x = r.f32()
            const y = r.f32()
            out.calibration.imu[key] = { x, y, z: r.f32() }
          }

          break
        }
        case SEC.ATT_ZERO: {
          const r = new Reader(payload)
          const w = r.f32()
          const x = r.f32()
          const y = r.f32()
          out.calibration.attitude_zero = { w, x, y, z: r.f32(), enabled: !!r.u8() }

          break
        }
 // No default
      }
    }
    // 未知 section 跳过（向前兼容：新固件导出的快照可被旧上位机读取）
  }

  return out
}

// ── 各 section 的构建（拆分为小函数，避免单函数复杂度过高）──

function buildConfigSection (cfg: Record<string, number | boolean>): Uint8Array {
  const p = new Writer()
  p.u8(CONFIG_INT_FIELDS.length)
  for (const key of CONFIG_INT_FIELDS) {
    p.i32(Number(cfg[key] ?? 0))
  }
  p.u8(CONFIG_BOOL_FIELDS.length)
  for (const key of CONFIG_BOOL_FIELDS) {
    p.u8(cfg[key] ? 1 : 0)
  }
  return p.toBytes()
}

function buildAnalogCalSection (analog: Record<string, AnalogCal>): Uint8Array {
  const p = new Writer()
  for (const key of ANALOG_KEYS) {
    const c = analog[key]
    p.i32(c?.raw_min ?? 0)
    p.i32(c?.raw_max ?? 4095)
    p.i32(c?.raw_center ?? 2047)
    p.i32(c?.deadzone ?? 0)
    p.u8(c?.invert ? 1 : 0)
    p.i8(c?.half_range ?? 0)
  }
  return p.toBytes()
}

function buildCurveSection (curves: Record<string, CurveData>): Uint8Array {
  const p = new Writer()
  for (const key of CURVE_KEYS) {
    const c = curves[key]
    p.i8(c?.x1 ?? 50)
    p.i8(c?.y1 ?? 50)
    p.i8(c?.x2 ?? 50)
    p.i8(c?.y2 ?? 50)
  }
  return p.toBytes()
}

function buildImuSection (imu: Record<string, Vec3>): Uint8Array {
  const p = new Writer()
  for (const key of IMU_KEYS) {
    const v = imu[key]
    p.f32(v?.x ?? 0)
    p.f32(v?.y ?? 0)
    p.f32(v?.z ?? 0)
  }
  return p.toBytes()
}

function buildAttZeroSection (z: ConfigBackupJson['calibration']['attitude_zero']): Uint8Array {
  const p = new Writer()
  p.f32(z.w ?? 1)
  p.f32(z.x ?? 0)
  p.f32(z.y ?? 0)
  p.f32(z.z ?? 0)
  p.u8(z.enabled ? 1 : 0)
  return p.toBytes()
}

/** JSON 对象 → 二进制快照 */
export function jsonToSnapshot (input: unknown): Uint8Array {
  if (!input || typeof input !== 'object') {
    throw new Error('文件内容不是对象')
  }
  const obj = input as Partial<ConfigBackupJson>
  if (obj.format !== 'gamepad2rc-config') {
    throw new Error('不是 GamePad2RC 配置文件')
  }
  if (obj.version !== SNAPSHOT_VERSION) {
    throw new Error(`不支持的文件版本: ${String(obj.version)}`)
  }

  const w = new Writer()
  for (const m of MAGIC) {
    w.u8(m)
  }
  w.u16(SNAPSHOT_VERSION)
  w.u8(MODEL_SLOTS)

  // 1) 全局标量字段
  appendSection(w, SEC.CONFIG, buildConfigSection(obj.config ?? {}))

  // 2) 模型（缺槽位不发 section → 设备侧该槽位保持默认）
  const models = Array.isArray(obj.models) ? obj.models : []
  for (let i = 0; i < MODEL_SLOTS; i++) {
    const m = models[i]
    if (!m) {
      continue
    }
    appendSection(w, SEC.MODEL_BASE + i, encodeModelTlv(m))
  }

  // 3) 校准数据
  const cal = obj.calibration
  if (cal?.analog) {
    appendSection(w, SEC.ANALOG_CAL, buildAnalogCalSection(cal.analog))
  }
  if (cal?.curves) {
    appendSection(w, SEC.ANALOG_CURVE, buildCurveSection(cal.curves))
  }
  if (cal?.imu) {
    appendSection(w, SEC.IMU_CAL, buildImuSection(cal.imu))
  }
  if (cal?.attitude_zero) {
    appendSection(w, SEC.ATT_ZERO, buildAttZeroSection(cal.attitude_zero))
  }

  return w.toBytes()
}
