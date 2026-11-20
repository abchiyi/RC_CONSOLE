import type { ModelConfig } from '@/stores/config'
import { decodeModelTlv, encodeModelTlv } from './commands'
/**
 * configSnapshot.ts — 配置备份的版本化编解码引擎
 *
 * 架构（Legacy_Config_Import_Plan.md）：
 *   固件 get_info 上报 cfg_schema_version = D（未上报 → V1 兼容模式）。
 *   前端按 major 维护独立引擎 engines[major] = { validate, decode, encode }：
 *     V1：0x0F 旧布局 [enabled,count,items...]，无 0x16 default_value
 *     V2：0x0F 新布局 [count,items...] + 0x16 default_value
 *   导入只允许向上：F>D 拒绝（不允许降级导入）；F<D 沿 MIGRATIONS 级联转码；F=D 直编。
 *   导出按设备版本 D 选引擎 decode，文件 version 标真实来源版本。
 *
 * 固件只认**二进制快照**（协议 §5.15），JSON 编解码全部在上位机。
 *
 * 快照布局（小端）：
 *   "RCS1" | u16 version | u8 model_slots
 *   section: u8 type + u32 len + payload
 *   type 0x01 全局标量 / 0x10+slot 模型 / 0x24 xbox_cfg
 *   0x20~0x23 校准类 —— 已退出备份（设备本地数据），导入忽略、导出不写
 */
import {
  decodeXboxBlob,
  defaultXboxConfig,
  encodeXboxBlob,
  XBOX_BLOB_SIZE,
  XBOX_BLOB_SIZE_V1,
  type XboxConfig,
} from './commands'
import { Reader, Writer } from './protocol'

const MAGIC = [0x52, 0x43, 0x53, 0x31] // 'R','C','S','1'
/** 二进制快照头版本（快照容器布局大改时才递增, 与 schema 版本解耦） */
export const SNAPSHOT_VERSION = 1
export const MODEL_SLOTS = 8

/** 前端引擎库支持的最高文件版本 */
export const BACKUP_VERSION = '2.0'
const BACKUP_MAJOR = 2

const SEC = {
  CONFIG: 0x01,
  MODEL_BASE: 0x10,
  ANALOG_CAL: 0x20,
  ANALOG_CURVE: 0x21,
  IMU_CAL: 0x22,
  ATT_ZERO: 0x23,
  XBOX_CFG: 0x24,
} as const

/** 与固件 config.h 的 CONFIG_INT_FIELDS 顺序一致（调序必须同步两端） */
export const CONFIG_INT_FIELDS = [
  'radio_mode', 'active_model', 'idle_warn_s', 'idle_shut_s', 'lpf_alpha',
] as const
/** 与固件 config.h 的 CONFIG_BOOL_FIELDS 顺序一致（新字段只能追加到末尾） */
export const CONFIG_BOOL_FIELDS = [
  'telem2_usb_en', 'telem2_bt_en', 'telem_rssi_cf', 'lock_zero_imu', 'silent_mode',
] as const

export interface ConfigBackupJson {
  format: 'gamepad2rc-config'
  version: string
  config: Record<string, number | boolean>
  models: ModelConfig[]
  /** Xbox 手柄输出映射/灵敏度；旧备份文件无此字段时按出厂默认处理 */
  xbox?: XboxConfig
}

// ============================================================
// 版本解析 / 结构探测 / 迁移管道
// ============================================================

interface FileVersion { major: number, minor: number }

/** 数字 1 → {1,0}; 字符串 "2.0" → {2,0}; 其余 → 抛错 */
function parseFileVersion (v: unknown): FileVersion {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) {
    return { major: v, minor: 0 }
  }
  if (typeof v === 'string') {
    const m = /^(\d+)\.(\d+)$/.exec(v.trim())
    if (m) return { major: Number(m[1]), minor: Number(m[2]) }
  }
  throw new Error(`无法解析的文件版本: ${String(v)}`)
}

/** 通道形状: pre=mix_enabled 时代 / post=default_value 时代 / none=无法判别 */
type ChannelShape = 'pre' | 'post' | 'none'

function classifyChannel (c: unknown): 'pre' | 'post' | 'skip' {
  if (!c || typeof c !== 'object') return 'skip'
  const hasMix = 'mix_enabled' in (c as object)
  const hasDefault = 'default_value' in (c as object)
  if (hasMix && !hasDefault) return 'pre'
  if (!hasMix && hasDefault) return 'post'
  return 'skip'
}

/**
 * 结构特征探测：version 字段在 ffe8335/f98c490 时未 bump，线上"version:1"
 * 文件存在两种形状。引擎选择以固件上报为准，此处仅作辅助校验（防文件标错版本）。
 */
function probeChannelShape (models: unknown[]): ChannelShape {
  let shape: ChannelShape = 'none'
  for (const m of models) {
    const channels = (m as { channels?: unknown[] } | undefined)?.channels
    if (!Array.isArray(channels)) continue
    for (const c of channels) {
      const s = classifyChannel(c)
      if (s === 'skip') continue
      if (shape !== 'none' && shape !== s) {
        throw new Error('文件结构自相矛盾: 通道数据同时含 mix_enabled 与 default_value 特征')
      }
      shape = s
    }
  }
  return shape
}

/**
 * 校验"声明版本"与"实际结构"自洽；矛盾即拒绝（不带病导入）。
 * 同 major 下结构特征允许差异（minor 兼容语义）。
 */
function checkShapeConsistency (major: number, shape: ChannelShape): void {
  if (shape === 'none') return
  if (major >= 2 && shape === 'pre') {
    throw new Error(
      '文件版本声明为 2.x，但通道数据含已废弃的 mix_enabled 字段（1.x 前期形状）——版本与结构不符',
    )
  }
  // major===1 + pre/post 都是线上真实存在的历史形状 → 放行给迁移/引擎
}

/**
 * 迁移管道: 键 = 源 major, 值 = 迁移到 major+1 的函数。
 * 每个函数对应一次真实的固件 schema 变更（变更须 bump major 并在此登记）。
 * 只增不删——旧版本迁移函数永远保留, 级联转码即按序链式调用。
 */
type LooseModel = Record<string, unknown>
type LooseChannel = Record<string, unknown>
type LooseBackup = {
  config: Record<string, unknown>
  models: LooseModel[]
  xbox?: unknown
}

const MIGRATIONS: Record<number, (b: LooseBackup) => LooseBackup> = {
  // 1.x → 2.0 (ffe8335/f98c490): 移除通道 mix_enabled 二级开关,
  // mix_items 长度即 mix 数量; 新增通道 default_value, 旧文件缺失按 0（未设置）
  1: (b) => {
    for (const m of b.models) {
      const channels = m.channels
      if (!Array.isArray(channels)) continue
      for (const c of channels as LooseChannel[]) {
        delete c.mix_enabled
        delete c.mix_count
        if (c.default_value === undefined) c.default_value = 0
      }
    }
    return b
  },
}

/** 归一化为宽松对象（迁移管道在对象层操作, 不假设 schema） */
function toLooseBackup (obj: Partial<ConfigBackupJson>): LooseBackup {
  return {
    config: (obj.config ?? {}) as Record<string, unknown>,
    models: (Array.isArray(obj.models) ? obj.models : []) as unknown as LooseModel[],
    xbox: obj.xbox,
  }
}

// ============================================================
// 编解码引擎注册表
// ============================================================

export interface CodecEngine {
  /** 引擎对应的固件 schema major 版本 */
  major: number
  /** 全局结构校验（模型槽位错误走 encode 的逐槽隔离, 不在此抛） */
  validate (b: LooseBackup): void
  /** JSON → 固件二进制快照（本引擎版本的布局）; 单槽失败经 onSlotError 隔离跳过 */
  encode (b: LooseBackup, onSlotError?: (e: SlotImportError) => void): Uint8Array
  /** 固件二进制快照 → JSON（本引擎版本的布局, version 标本引擎版本） */
  decode (bytes: Uint8Array): ConfigBackupJson
}

function makeEngine (major: number, legacyMix: boolean): CodecEngine {
  return {
    major,
    validate () { /* 全局校验已在导入入口完成（版本/结构一致性） */ },
    encode (b, onSlotError) {
      const w = new Writer()
      for (const m of MAGIC) w.u8(m)
      w.u16(SNAPSHOT_VERSION)
      w.u8(MODEL_SLOTS)
      appendSection(w, SEC.CONFIG, buildConfigSection(b.config as Record<string, number | boolean>))
      for (let i = 0; i < MODEL_SLOTS; i++) {
        const m = b.models[i]
        if (!m) continue
        try {
          if (!Array.isArray(m.channels)) {
            throw new Error('缺少 channels 数组')
          }
          appendSection(w, SEC.MODEL_BASE + i, encodeModelTlv(m as unknown as ModelConfig, legacyMix))
        } catch (e: unknown) {
          onSlotError?.({
            slot: i,
            name: typeof m.name === 'string' ? m.name : `槽位${i}`,
            reason: e instanceof Error ? e.message : String(e),
          })
        }
      }
      appendSection(w, SEC.XBOX_CFG, buildXboxSection(b.xbox as XboxConfig | undefined))
      return w.toBytes()
    },
    decode (bytes) {
      return parseSnapshot(bytes, major, legacyMix)
    },
  }
}

/** 引擎注册表: 键 = 固件 schema major。新版本在此登记。 */
export const ENGINES: Record<number, CodecEngine> = {
  1: makeEngine(1, true), // V1: 0x0F 旧布局
  2: makeEngine(2, false), // V2: 0x0F 新布局 + 0x16 default_value（当前）
}

// ============================================================
// 导入 / 导出主入口
// ============================================================

export interface SlotImportError {
  slot: number
  name: string
  reason: string
}

export interface ImportResult {
  snapshot: Uint8Array
  /** 非致命提示（calibration 忽略、兼容模式、迁移警告等） */
  notices: string[]
  /** 逐槽隔离的失败列表（该槽跳过, 其余继续） */
  slotErrors: SlotImportError[]
}

/**
 * JSON 备份文件 → 二进制快照（导入主入口）
 *
 * @param deviceSchema 设备上报的 cfg_schema_version（"major.minor"）；undefined → V1 兼容模式
 *
 * F>D 拒绝（不允许降级导入）；F<D 级联迁移；最后由设备版本的引擎编码。
 * calibration 一律忽略（设备本地数据, 不跨机复用）。
 */
export function importBackupJson (input: unknown, deviceSchema?: string): ImportResult {
  if (!input || typeof input !== 'object') {
    throw new Error('文件内容不是对象')
  }
  const obj = structuredClone(input) as Partial<ConfigBackupJson> & { calibration?: unknown }
  if (obj.format !== 'gamepad2rc-config') {
    throw new Error('不是 GamePad2RC 配置文件')
  }

  const notices: string[] = []
  if (obj.calibration !== undefined) {
    notices.push('已忽略文件中的 calibration 段：校准数据属于设备本地数据，不随配置备份导入')
  }

  // ── 设备版本（版本事实来源; 未上报 = V1 兼容模式）──
  let deviceMajor: number
  if (deviceSchema === undefined) {
    deviceMajor = 1
    notices.push('设备未上报配置版本，按 V1 兼容模式处理')
  } else {
    deviceMajor = parseFileVersion(deviceSchema).major
  }
  const engine = ENGINES[deviceMajor]
  if (!engine) {
    throw new Error(`设备配置版本 ${deviceMajor}.x 高于上位机支持的最高版本 ${BACKUP_VERSION}，请升级上位机`)
  }

  // ── 文件版本 vs 设备版本 ──
  const declared = parseFileVersion(obj.version)
  if (declared.major > deviceMajor) {
    throw new Error(
      `配置文件版本 ${declared.major}.${declared.minor} 高于设备固件支持的 ${deviceMajor}.x——` +
      '不允许降级导入，请先升级设备固件',
    )
  }

  const models = Array.isArray(obj.models) ? obj.models : []
  const shape = probeChannelShape(models)
  checkShapeConsistency(declared.major, shape)

  // V1 设备 + 含 default_value 的文件 → 0x16 会被丢弃, 数据有损
  if (deviceMajor < 2 && shape === 'post') {
    notices.push('文件含 default_value 字段，V1 固件不支持该字段，导入后将丢失（其余数据不受影响）')
  }

  // ── 级联迁移: F → F+1 → … → D ──
  let cur: LooseBackup = toLooseBackup(obj)
  for (let major = declared.major; major < deviceMajor; major++) {
    const step = MIGRATIONS[major]
    if (!step) {
      throw new Error(`缺少版本 ${major} → ${major + 1} 的迁移函数（文件版本 ${declared.major}.${declared.minor}）`)
    }
    cur = step(cur)
  }

  // ── 设备版本引擎: 校验 + 编码（逐槽隔离内建于引擎）──
  engine.validate(cur)
  const slotErrors: SlotImportError[] = []
  const snapshot = engine.encode(cur, (e) => slotErrors.push(e))

  return { snapshot, notices, slotErrors }
}

/**
 * 固件二进制快照 → JSON 对象（导出主入口）
 *
 * @param deviceSchema 设备上报的 cfg_schema_version；undefined → V1 兼容模式（旧固件快照）
 * 文件 version 标设备真实版本, 不虚标。
 */
export function snapshotToJson (bytes: Uint8Array, deviceSchema?: string): ConfigBackupJson {
  const deviceMajor = deviceSchema === undefined
    ? 1 // 未上报 = 早于上报机制 = V1 布局
    : parseFileVersion(deviceSchema).major
  const engine = ENGINES[deviceMajor]
  if (!engine) {
    throw new Error(`设备配置版本 ${deviceMajor}.x 高于上位机支持的最高版本 ${BACKUP_VERSION}，请升级上位机`)
  }
  return engine.decode(bytes)
}

// ============================================================
// 快照容器编解码（V1/V2 引擎共用, 仅模型 TLV 布局不同）
// ============================================================

function appendSection (w: Writer, type: number, payload: Uint8Array): void {
  w.u8(type)
  w.u32(payload.length)
  w.bytes(payload)
}

function emptyBackup (version: string): ConfigBackupJson {
  return {
    format: 'gamepad2rc-config',
    version,
    config: {},
    models: [],
  }
}

/** 解析 Xbox section；长度/版本不符或坏数据一律忽略，保持默认值 */
function parseXboxSection (payload: Uint8Array, len: number): XboxConfig | undefined {
  if (len !== XBOX_BLOB_SIZE && len !== XBOX_BLOB_SIZE_V1) {
    return undefined
  }
  try {
    return decodeXboxBlob(payload)
  } catch {
    return undefined
  }
}

function parseSnapshot (bytes: Uint8Array, major: number, legacyMix: boolean): ConfigBackupJson {
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

  const out = emptyBackup(`${major}.0`)

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
      out.models[type - SEC.MODEL_BASE] = decodeModelTlv(payload, legacyMix)
    } else if (type >= SEC.ANALOG_CAL && type <= SEC.ATT_ZERO) {
      // 校准类 section: 已退出备份范围, 导出时丢弃（旧固件快照可能仍携带）
      continue
    } else if (type === SEC.XBOX_CFG) {
      out.xbox = parseXboxSection(payload, len) ?? out.xbox
    }
    // 其余未知 section 跳过（向前兼容：新固件导出的快照可被旧上位机读取）
  }

  return out
}

// ── section 构建 ──

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

/** Xbox 配置 section：直接用协议同款 19B blob，不另造格式 */
function buildXboxSection (cfg: XboxConfig | undefined): Uint8Array {
  return encodeXboxBlob(cfg ?? defaultXboxConfig())
}
