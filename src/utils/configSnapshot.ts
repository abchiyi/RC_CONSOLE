import type { ModelConfig } from '@/stores/config'
import { decodeModelTlv, encodeModelTlv } from './commands'
/**
 * configSnapshot.ts — 配置快照（二进制）↔ JSON 备份文件
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
 *   type 0x20~0x23   校准类 section —— **已退出备份范围**（设备本地数据，见
 *                    Legacy_Config_Import_Plan.md §四）：导出不写，导入忽略
 *   type 0x24        xbox_cfg     : v2 64B (version + 6×轴 + 15×按钮)；v1 19B 可读入
 *
 * ── 文件版本规则（对齐系统版本语义）──
 *   version = "major.minor" 字符串；
 *   major：破坏性变更（字段语义重排/结构大改）→ 导入必须经迁移函数；
 *   minor：增删条目但结构不变 → 同 major 下天然兼容（缺键默认、多键跳过）。
 *   历史 version: 1（数字）视为 major=1。schema 变更必须 bump major——
 *   把"变更须声明"固化为规则（Legacy_Config_Import_Plan.md）。
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
/** 二进制快照头版本（TLV 布局大改时才递增） */
export const SNAPSHOT_VERSION = 1
export const MODEL_SLOTS = 8

/** JSON 备份文件的当前版本 */
export const BACKUP_VERSION = '2.0'
const BACKUP_MAJOR = 2

const SEC = {
  CONFIG: 0x01,
  MODEL_BASE: 0x10,
  // 0x20~0x23（analog_cal/curve/imu/att_zero）不再编解码, 保留常量仅为导入时识别跳过
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
// 文件版本解析 / 结构探测 / 迁移管道
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
 * 文件存在两种形状，必须以实际字段存在性判别（不信任声明的版本号）。
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
        // 同一文件里两种形状并存 → 结构自相矛盾
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
  // major===1 + pre/post 都是线上真实存在的历史形状 → 一律放行给迁移管道
}

/**
 * 迁移管道: 键 = 源 major, 值 = 迁移到 major+1 的函数。
 * 每个函数对应一次真实的固件 schema 变更（变更须 bump major 并在此登记）。
 * 只增不删——旧版本迁移函数永远保留。
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

/** 校验单个模型槽位能否安全编码; 返回原因（null=通过） */
function validateSlot (m: LooseModel, slot: number): string | null {
  const name = typeof m.name === 'string' ? m.name : `槽位${slot}`
  if (!Array.isArray(m.channels)) return `${name}: 缺少 channels 数组`
  return null
}

export interface SlotImportError {
  slot: number
  name: string
  reason: string
}

export interface ImportResult {
  snapshot: Uint8Array
  /** 非致命提示（如"校准数据不在备份范围"） */
  notices: string[]
  /** 逐槽隔离的失败列表（该槽跳过, 其余继续） */
  slotErrors: SlotImportError[]
}

/**
 * JSON 备份文件 → 二进制快照（导入主入口）
 *
 * ① version + 结构双重校验 → ② major 迁移管道 → ③ 当前 schema 编码。
 * calibration 一律忽略（设备本地数据, 不跨机复用）。
 */
export function importBackupJson (input: unknown): ImportResult {
  if (!input || typeof input !== 'object') {
    throw new Error('文件内容不是对象')
  }
  // 深拷贝: 迁移管道会改写通道对象 (删 mix_enabled / 补 default_value),
  // 必须与调用方的输入隔离, 否则同一文件二次导入时结构特征已被抹掉
  const obj = structuredClone(input) as Partial<ConfigBackupJson> & { calibration?: unknown }
  if (obj.format !== 'gamepad2rc-config') {
    throw new Error('不是 GamePad2RC 配置文件')
  }

  const notices: string[] = []
  if (obj.calibration !== undefined) {
    notices.push('已忽略文件中的 calibration 段：校准数据属于设备本地数据，不随配置备份导入')
  }

  const declared = parseFileVersion(obj.version)
  if (declared.major > BACKUP_MAJOR) {
    throw new Error(
      `文件版本 ${declared.major}.${declared.minor} 高于当前支持的最高版本 ${BACKUP_VERSION}，请升级上位机`,
    )
  }
  const models = Array.isArray(obj.models) ? obj.models : []
  const shape = probeChannelShape(models)
  checkShapeConsistency(declared.major, shape)

  // 迁移管道: 从声明 major 逐级升到当前 major
  let cur: LooseBackup = toLooseBackup(obj)
  for (let major = declared.major; major < BACKUP_MAJOR; major++) {
    const step = MIGRATIONS[major]
    if (!step) {
      throw new Error(`缺少版本 ${major} → ${major + 1} 的迁移函数（文件版本 ${declared.major}.${declared.minor}）`)
    }
    cur = step(cur)
  }

  // ── 编码（当前 schema）──
  const w = new Writer()
  for (const m of MAGIC) {
    w.u8(m)
  }
  w.u16(SNAPSHOT_VERSION)
  w.u8(MODEL_SLOTS)

  // 1) 全局标量字段
  appendSection(w, SEC.CONFIG, buildConfigSection(cur.config as Record<string, number | boolean>))

  // 2) 模型: 逐槽隔离——坏槽跳过并记录, 其余继续
  const slotErrors: SlotImportError[] = []
  for (let i = 0; i < MODEL_SLOTS; i++) {
    const m = cur.models[i]
    if (!m) continue
    const reason = validateSlot(m, i)
    if (reason) {
      slotErrors.push({ slot: i, name: typeof m.name === 'string' ? m.name : `槽位${i}`, reason })
      continue
    }
    try {
      appendSection(w, SEC.MODEL_BASE + i, encodeModelTlv(m as unknown as ModelConfig))
    } catch (e: unknown) {
      slotErrors.push({
        slot: i,
        name: typeof m.name === 'string' ? m.name : `槽位${i}`,
        reason: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // 3) Xbox 手柄映射/灵敏度（可选段；缺失按出厂默认写入，
  //    固件侧未知 section 自动跳过，两端都向前兼容）
  appendSection(w, SEC.XBOX_CFG, buildXboxSection(cur.xbox as XboxConfig | undefined))

  return { snapshot: w.toBytes(), notices, slotErrors }
}

// ============================================================
// 二进制快照 ↔ JSON
// ============================================================

function appendSection (w: Writer, type: number, payload: Uint8Array): void {
  w.u8(type)
  w.u32(payload.length)
  w.bytes(payload)
}

function emptyBackup (): ConfigBackupJson {
  return {
    format: 'gamepad2rc-config',
    version: BACKUP_VERSION,
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

/** 二进制快照 → JSON 对象（导出；校准类 section 0x20~0x23 一律跳过） */
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

// ── 各 section 的构建 ──

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
